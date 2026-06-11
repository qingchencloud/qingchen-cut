import { issue, type QcIssue } from "@qingchen/cut-dsl";
import { resolveTool, run } from "./ffmpeg";
import { probeMedia, type MediaInfo } from "./probe";

/**
 * 素材分析：场景切换点、静音段、响度。
 * 输出 JSON 供 AI 做粗剪决策（在哪切、删哪段、要不要响度归一）。
 */

export interface SceneChange {
  atSec: number;
  /** 0~1，越大画面变化越剧烈 */
  score: number;
}

export interface SilenceRange {
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface LoudnessInfo {
  /** 综合响度 LUFS（短视频平台常见目标 -14 ~ -16） */
  inputI: number;
  /** 真峰值 dBTP */
  inputTp: number;
  /** 响度动态范围 LU */
  inputLra: number;
  inputThresh: number;
}

export interface AnalyzeResult {
  ok: boolean;
  path?: string;
  durationSec?: number;
  scenes?: SceneChange[];
  silences?: SilenceRange[];
  loudness?: LoudnessInfo | null;
  issues: QcIssue[];
}

export interface AnalyzeOptions {
  /** 场景切换灵敏度阈值，0~1，默认 0.3；越低检出越多 */
  sceneThreshold?: number;
  /** 静音判定电平 dB，默认 -30 */
  silenceDb?: number;
  /** 静音最短时长（秒），默认 0.5 */
  silenceMinSec?: number;
}

export async function analyzeMedia(mediaPath: string, opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  const sceneThreshold = opts.sceneThreshold ?? 0.3;
  const silenceDb = opts.silenceDb ?? -30;
  const silenceMinSec = opts.silenceMinSec ?? 0.5;

  const probed = await probeMedia(mediaPath);
  if (!probed.info) return { ok: false, issues: probed.issues };
  const info: MediaInfo = probed.info;

  const ffmpeg = resolveTool("ffmpeg");
  if (!ffmpeg) {
    return { ok: false, issues: [issue("FFMPEG_NOT_FOUND", "probe", "找不到 ffmpeg", { suggestion: "运行 qc doctor" })] };
  }

  const issues: QcIssue[] = [];
  let scenes: SceneChange[] = [];
  let silences: SilenceRange[] = [];
  let loudness: LoudnessInfo | null = null;

  // —— 场景切换（视频流） ——
  if (info.video) {
    const result = await run(
      ffmpeg.path,
      [
        "-hide_banner", "-i", mediaPath,
        "-vf", `select='gt(scene,${sceneThreshold})',metadata=print:file=-`,
        "-an", "-f", "null", process.platform === "win32" ? "NUL" : "-",
      ],
      { timeoutMs: 600_000 },
    );
    if (result.code !== 0) {
      issues.push(issue("ANALYZE_SCENE_FAILED", "probe", `场景检测失败: ${result.stderr.slice(-400)}`, { level: "warning" }));
    } else {
      // metadata=print 输出形如：
      // frame:0    pts:123  pts_time:4.1
      // lavfi.scene_score=0.53
      let currentTime: number | null = null;
      for (const line of result.stdout.split(/\r?\n/)) {
        const t = /pts_time:([\d.]+)/.exec(line);
        if (t) currentTime = Number(t[1]);
        const s = /lavfi\.scene_score=([\d.]+)/.exec(line);
        if (s && currentTime !== null) {
          scenes.push({ atSec: Math.round(currentTime * 1000) / 1000, score: Number(s[1]) });
          currentTime = null;
        }
      }
    }
  }

  // —— 静音段 + 响度（音频流，一次跑完） ——
  if (info.audio.length > 0) {
    const result = await run(
      ffmpeg.path,
      [
        "-hide_banner", "-i", mediaPath,
        "-af", `silencedetect=noise=${silenceDb}dB:d=${silenceMinSec},loudnorm=print_format=json`,
        "-vn", "-f", "null", process.platform === "win32" ? "NUL" : "-",
      ],
      { timeoutMs: 600_000 },
    );
    if (result.code !== 0) {
      issues.push(issue("ANALYZE_AUDIO_FAILED", "probe", `音频分析失败: ${result.stderr.slice(-400)}`, { level: "warning" }));
    } else {
      let pendingStart: number | null = null;
      for (const line of result.stderr.split(/\r?\n/)) {
        const start = /silence_start:\s*([\d.]+)/.exec(line);
        if (start) pendingStart = Number(start[1]);
        const end = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/.exec(line);
        if (end && pendingStart !== null) {
          silences.push({
            startSec: Math.round(pendingStart * 1000) / 1000,
            endSec: Math.round(Number(end[1]) * 1000) / 1000,
            durationSec: Math.round(Number(end[2]) * 1000) / 1000,
          });
          pendingStart = null;
        }
      }
      // 文件以静音结尾时没有 silence_end
      if (pendingStart !== null) {
        silences.push({
          startSec: Math.round(pendingStart * 1000) / 1000,
          endSec: Math.round(info.durationSec * 1000) / 1000,
          durationSec: Math.round((info.durationSec - pendingStart) * 1000) / 1000,
        });
      }
      // loudnorm 的 JSON 报告在 stderr 末尾
      const jsonMatch = /\{[^{}]*"input_i"[\s\S]*?\}/.exec(result.stderr);
      if (jsonMatch) {
        try {
          const raw = JSON.parse(jsonMatch[0]);
          loudness = {
            inputI: Number(raw.input_i),
            inputTp: Number(raw.input_tp),
            inputLra: Number(raw.input_lra),
            inputThresh: Number(raw.input_thresh),
          };
        } catch {
          issues.push(issue("ANALYZE_LOUDNESS_PARSE", "probe", "响度报告解析失败", { level: "warning" }));
        }
      }
    }
  }

  return {
    ok: true,
    path: mediaPath,
    durationSec: info.durationSec,
    scenes,
    silences,
    loudness,
    issues,
  };
}
