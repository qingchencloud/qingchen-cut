import {
  clipVisibleDuration,
  hasErrors,
  issue,
  parseJobText,
  videoTrackDuration,
  type Job,
  type QcIssue,
} from "@qingchen/cut-dsl";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { probeMedia, type MediaInfo } from "./probe";

/** DSL 中的路径：绝对路径原样返回，相对路径相对于 job 文件所在目录解析 */
export function resolveJobPath(jobDir: string, p: string): string {
  return isAbsolute(p) ? p : resolve(jobDir, p);
}

export interface ValidateOptions {
  /** 跳过 ffprobe 深度校验（只做 schema/语义/文件存在性检查），更快 */
  skipProbe?: boolean;
}

export interface ValidateResult {
  ok: boolean;
  job?: Job;
  /** 探测到的素材元数据，assetId → MediaInfo，供 plan/render 复用 */
  assetInfo?: Record<string, MediaInfo>;
  /** 计算出的成片总时长（秒） */
  totalDurationSec?: number;
  issues: QcIssue[];
}

/**
 * 完整校验：JSON → schema → 语义 → 文件系统 → （可选）ffprobe 深度校验。
 * 深度校验会检查 clip 的 in/out 是否超出素材实际时长。
 */
export async function validateJobFile(jobFilePath: string, opts: ValidateOptions = {}): Promise<ValidateResult> {
  if (!existsSync(jobFilePath)) {
    return {
      ok: false,
      issues: [
        issue("FS_JOB_NOT_FOUND", "validate", `job 文件不存在: ${jobFilePath}`, {
          suggestion: "检查路径；qc validate 的参数是 DSL JSON 文件路径",
        }),
      ],
    };
  }

  const text = readFileSync(jobFilePath, "utf8");
  const parsed = parseJobText(text);
  if (!parsed.job || hasErrors(parsed.issues)) {
    return { ok: false, job: parsed.job, issues: parsed.issues };
  }

  const job = parsed.job;
  const jobDir = dirname(resolve(jobFilePath));
  const issues: QcIssue[] = [...parsed.issues];

  // 文件存在性
  job.assets.forEach((asset, i) => {
    const full = resolveJobPath(jobDir, asset.path);
    if (!existsSync(full)) {
      issues.push(
        issue("FS_ASSET_NOT_FOUND", "validate", `素材文件不存在: ${full}`, {
          path: `/assets/${i}/path`,
          suggestion: "检查路径拼写与大小写；相对路径相对于 job 文件所在目录解析",
        }),
      );
    }
  });

  job.tracks.forEach((track, t) => {
    if (track.type !== "subtitle") return;
    const src = "srt" in track.source ? track.source.srt : track.source.ass;
    const full = resolveJobPath(jobDir, src);
    if (!existsSync(full)) {
      issues.push(
        issue("FS_SUBTITLE_NOT_FOUND", "validate", `字幕文件不存在: ${full}`, {
          path: `/tracks/${t}/source`,
        }),
      );
    }
  });

  const outDir = dirname(resolveJobPath(jobDir, job.export.output));
  if (!existsSync(outDir)) {
    issues.push(
      issue("FS_OUTPUT_DIR_NOT_FOUND", "validate", `输出目录不存在: ${outDir}`, {
        path: "/export/output",
        suggestion: "先创建该目录，或改用已存在的输出目录",
        level: "warning", // render 时会自动创建，这里只提醒
      }),
    );
  }

  if (hasErrors(issues)) {
    return { ok: false, job, issues };
  }

  // ffprobe 深度校验
  const assetInfo: Record<string, MediaInfo> = {};
  if (!opts.skipProbe) {
    for (const asset of job.assets) {
      const full = resolveJobPath(jobDir, asset.path);
      const probed = await probeMedia(full);
      issues.push(...probed.issues);
      if (probed.info) assetInfo[asset.id] = probed.info;
    }

    job.tracks.forEach((track, t) => {
      if (track.type === "video") {
        track.clips.forEach((clip, c) => {
          const info = assetInfo[clip.assetId];
          if (!info) return;
          if (clip.out > info.durationSec + 0.001) {
            issues.push(
              issue(
                "DSL_OUT_EXCEEDS_DURATION",
                "validate",
                `clip 的 out (${clip.out}s) 超出素材实际时长 ${info.durationSec.toFixed(3)}s`,
                {
                  path: `/tracks/${t}/clips/${c}/out`,
                  suggestion: `把 out 降到 ${info.durationSec.toFixed(3)} 以内`,
                },
              ),
            );
          }
          if (!info.video) {
            issues.push(
              issue("DSL_ASSET_NO_VIDEO", "validate", `素材 "${clip.assetId}" 没有视频轨，不能放进 video 轨道`, {
                path: `/tracks/${t}/clips/${c}/assetId`,
                suggestion: "音频素材请放进 audio 轨道",
              }),
            );
          }
        });
      }
      if (track.type === "audio") {
        track.clips.forEach((clip, c) => {
          const info = assetInfo[clip.assetId];
          if (!info) return;
          if (info.audio.length === 0) {
            issues.push(
              issue("DSL_ASSET_NO_AUDIO", "validate", `素材 "${clip.assetId}" 没有音频轨`, {
                path: `/tracks/${t}/clips/${c}/assetId`,
              }),
            );
          }
        });
      }
    });
  }

  const videoTrack = job.tracks.find((tr) => tr.type === "video");
  const totalDurationSec = videoTrack && videoTrack.type === "video" ? videoTrackDuration(videoTrack) : 0;

  return { ok: !hasErrors(issues), job, assetInfo, totalDurationSec, issues };
}

export { clipVisibleDuration };
