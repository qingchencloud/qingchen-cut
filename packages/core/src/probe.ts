import { issue, type QcIssue } from "@qingchen/cut-dsl";
import { existsSync } from "node:fs";
import { resolveTool, run } from "./ffmpeg";

export interface VideoStreamInfo {
  codec: string;
  width: number;
  height: number;
  fps: number;
  /** 元数据旋转角度（手机竖拍常见 90/270），渲染时需要考虑 */
  rotation: number;
}

export interface AudioStreamInfo {
  codec: string;
  channels: number;
  sampleRate: number;
}

export interface MediaInfo {
  path: string;
  container: string;
  durationSec: number;
  sizeBytes: number;
  video: VideoStreamInfo | null;
  audio: AudioStreamInfo[];
}

export interface ProbeResult {
  info?: MediaInfo;
  issues: QcIssue[];
}

/** ffprobe 包装：读取本地媒体元数据，输出干净的 JSON 结构 */
export async function probeMedia(mediaPath: string): Promise<ProbeResult> {
  if (!existsSync(mediaPath)) {
    return {
      issues: [
        issue("FS_MEDIA_NOT_FOUND", "probe", `文件不存在: ${mediaPath}`, {
          suggestion: "检查路径拼写；相对路径相对于 job 文件所在目录解析",
        }),
      ],
    };
  }

  const ffprobe = resolveTool("ffprobe");
  if (!ffprobe) {
    return {
      issues: [
        issue("FFPROBE_NOT_FOUND", "probe", "找不到 ffprobe 可执行文件", {
          suggestion: "运行 qc doctor 查看环境诊断；安装 FFmpeg 或设置 QC_FFMPEG_PATH",
        }),
      ],
    };
  }

  const result = await run(
    ffprobe.path,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", mediaPath],
    { timeoutMs: 30_000 },
  );

  if (result.code !== 0) {
    return {
      issues: [
        issue("PROBE_FAILED", "probe", `ffprobe 解析失败: ${result.stderr.trim().slice(0, 500)}`, {
          suggestion: "文件可能损坏或不是受支持的媒体格式",
        }),
      ],
    };
  }

  let raw: any;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    return { issues: [issue("PROBE_FAILED", "probe", "ffprobe 输出无法解析为 JSON")] };
  }

  const format = raw.format ?? {};
  const streams: any[] = raw.streams ?? [];

  const v = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  let video: VideoStreamInfo | null = null;
  if (v) {
    const [num, den] = String(v.avg_frame_rate ?? v.r_frame_rate ?? "0/1")
      .split("/")
      .map(Number);
    const rotation =
      Number(v.side_data_list?.find((d: any) => d.rotation != null)?.rotation ?? v.tags?.rotate ?? 0) || 0;
    video = {
      codec: String(v.codec_name ?? "unknown"),
      width: Number(v.width ?? 0),
      height: Number(v.height ?? 0),
      fps: den ? Math.round((num / den) * 1000) / 1000 : 0,
      rotation: ((rotation % 360) + 360) % 360,
    };
  }

  const audio: AudioStreamInfo[] = streams
    .filter((s) => s.codec_type === "audio")
    .map((s) => ({
      codec: String(s.codec_name ?? "unknown"),
      channels: Number(s.channels ?? 0),
      sampleRate: Number(s.sample_rate ?? 0),
    }));

  return {
    info: {
      path: mediaPath,
      container: String(format.format_name ?? "unknown"),
      durationSec: Number(format.duration ?? 0),
      sizeBytes: Number(format.size ?? 0),
      video,
      audio,
    },
    issues: [],
  };
}
