import type { Job, VideoClip, VideoTrack } from "./schema";
import { issue, type QcIssue } from "./issues";

/** clip 在成片中的可见时长（秒），变速后 */
export function clipVisibleDuration(clip: VideoClip): number {
  return (clip.out - clip.in) / clip.speed;
}

/**
 * 主视频轨成片总时长 = Σclip 可见时长 − Σtransition 时长。
 * transition 语义：与下一个 clip 重叠 duration 秒。
 */
export function videoTrackDuration(track: VideoTrack): number {
  let total = 0;
  for (const clip of track.clips) {
    total += clipVisibleDuration(clip);
    if (clip.transitionOut) total -= clip.transitionOut.duration;
  }
  return total;
}

/**
 * 纯语义校验（不访问文件系统）。schema 校验通过后调用。
 */
export function validateSemantics(job: Job): QcIssue[] {
  const issues: QcIssue[] = [];

  const assetIds = new Set<string>();
  job.assets.forEach((asset, i) => {
    if (assetIds.has(asset.id)) {
      issues.push(
        issue("DSL_DUPLICATE_ASSET_ID", "validate", `素材 ID 重复: "${asset.id}"`, {
          path: `/assets/${i}/id`,
          suggestion: "给每个素材取唯一的 id",
        }),
      );
    }
    assetIds.add(asset.id);
  });

  const trackIds = new Set<string>();
  const videoTracks: { track: VideoTrack; index: number }[] = [];

  job.tracks.forEach((track, t) => {
    if (trackIds.has(track.id)) {
      issues.push(
        issue("DSL_DUPLICATE_TRACK_ID", "validate", `轨道 ID 重复: "${track.id}"`, {
          path: `/tracks/${t}/id`,
          suggestion: "给每条轨道取唯一的 id",
        }),
      );
    }
    trackIds.add(track.id);

    if (track.type === "video") {
      videoTracks.push({ track, index: t });
      track.clips.forEach((clip, c) => {
        const base = `/tracks/${t}/clips/${c}`;
        if (!assetIds.has(clip.assetId)) {
          issues.push(
            issue("DSL_UNKNOWN_ASSET_REF", "validate", `clip 引用了不存在的素材 "${clip.assetId}"`, {
              path: `${base}/assetId`,
              suggestion: `可用的素材 id: ${[...assetIds].join(", ") || "（无，请先在 assets 中声明）"}`,
            }),
          );
        }
        if (clip.out <= clip.in) {
          issues.push(
            issue("DSL_TIME_RANGE", "validate", `clip 的 out (${clip.out}) 必须大于 in (${clip.in})`, {
              path: `${base}/out`,
              suggestion: "检查素材取用区间，out 是素材上的结束时间点而不是时长",
            }),
          );
        }
      });

      // transition 约束：d ≤ min(两侧可见时长) / 2，且不能挂在最后一个 clip 上
      track.clips.forEach((clip, c) => {
        if (!clip.transitionOut) return;
        const base = `/tracks/${t}/clips/${c}/transitionOut`;
        const next = track.clips[c + 1];
        if (!next) {
          issues.push(
            issue("DSL_TRANSITION_AT_END", "validate", "最后一个 clip 不能有 transitionOut（没有下一个片段可以过渡）", {
              path: base,
              suggestion: "删除最后一个 clip 的 transitionOut，或在其后追加片段",
            }),
          );
          return;
        }
        if (clip.out <= clip.in || next.out <= next.in) return; // 时间区间本身有错时跳过，避免噪声
        const maxAllowed = Math.min(clipVisibleDuration(clip), clipVisibleDuration(next)) / 2;
        if (clip.transitionOut.duration > maxAllowed) {
          issues.push(
            issue(
              "DSL_TRANSITION_TOO_LONG",
              "validate",
              `转场时长 ${clip.transitionOut.duration}s 超过允许上限 ${maxAllowed.toFixed(3)}s（相邻 clip 可见时长较小者的一半）`,
              {
                path: `${base}/duration`,
                suggestion: `把 duration 降到 ${maxAllowed.toFixed(3)} 以内，或加长相邻片段`,
              },
            ),
          );
        }
      });
    }

    if (track.type === "audio") {
      track.clips.forEach((clip, c) => {
        if (!assetIds.has(clip.assetId)) {
          issues.push(
            issue("DSL_UNKNOWN_ASSET_REF", "validate", `clip 引用了不存在的素材 "${clip.assetId}"`, {
              path: `/tracks/${t}/clips/${c}/assetId`,
              suggestion: `可用的素材 id: ${[...assetIds].join(", ") || "（无，请先在 assets 中声明）"}`,
            }),
          );
        }
        if (typeof clip.duration === "number" && clip.fadeIn + clip.fadeOut > clip.duration) {
          issues.push(
            issue("DSL_FADE_TOO_LONG", "validate", `fadeIn + fadeOut (${clip.fadeIn + clip.fadeOut}s) 超过片段时长 ${clip.duration}s`, {
              path: `/tracks/${t}/clips/${c}`,
              suggestion: "缩短淡入淡出或加长片段",
            }),
          );
        }
      });
    }
  });

  if (videoTracks.length === 0) {
    issues.push(
      issue("DSL_NO_VIDEO_TRACK", "validate", "至少需要一条 video 轨道", {
        path: "/tracks",
        suggestion: '添加 { "type": "video", "id": "v1", "clips": [...] }',
      }),
    );
  } else if (videoTracks.length > 1) {
    issues.push(
      issue("DSL_MULTI_VIDEO_TRACK", "validate", "v1 仅支持一条 video 轨道（多轨叠加在后续版本开放）", {
        path: `/tracks/${videoTracks[1]!.index}`,
        suggestion: "把所有视频片段按顺序放进同一条 video 轨的 clips 数组",
      }),
    );
  }

  if (!/\.mp4$/i.test(job.export.output)) {
    issues.push(
      issue("DSL_OUTPUT_EXT", "validate", `输出路径必须以 .mp4 结尾: "${job.export.output}"`, {
        path: "/export/output",
        suggestion: "修改 export.output 的扩展名为 .mp4",
      }),
    );
  }

  // 文字/字幕轨的时间提示：超出成片长度的文字永远不会显示
  if (videoTracks.length === 1) {
    const total = videoTrackDuration(videoTracks[0]!.track);
    job.tracks.forEach((track, t) => {
      if (track.type !== "text") return;
      track.clips.forEach((clip, c) => {
        if (clip.start >= total && total > 0) {
          issues.push(
            issue("DSL_TEXT_AFTER_END", "validate", `文字出现时刻 ${clip.start}s 不早于成片总时长 ${total.toFixed(3)}s，永远不会显示`, {
              path: `/tracks/${t}/clips/${c}/start`,
              suggestion: `把 start 调整到 0 ~ ${total.toFixed(3)} 之间`,
              level: "warning",
            }),
          );
        }
      });
    });
  }

  return issues;
}
