import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveTool, run } from "./ffmpeg";
import { resolveWhisper, resolveWhisperModel } from "./transcribe";

export interface DoctorCheck {
  id: string;
  ok: boolean;
  detail: string;
  suggestion?: string;
  /** 可选能力（如转写），失败不影响整体 ok */
  optional?: boolean;
}

export interface DoctorReport {
  ok: boolean;
  platform: string;
  checks: DoctorCheck[];
}

const CJK_FONT_CANDIDATES = [
  { file: "msyh.ttc", name: "Microsoft YaHei" },
  { file: "msyhbd.ttc", name: "Microsoft YaHei Bold" },
  { file: "simhei.ttf", name: "SimHei" },
  { file: "simsun.ttc", name: "SimSun" },
];

/** 环境诊断：FFmpeg/FFprobe 在位、关键滤镜可用、中文字体可用 */
export async function runDoctor(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  const ffmpeg = resolveTool("ffmpeg");
  if (ffmpeg) {
    const ver = await run(ffmpeg.path, ["-version"], { timeoutMs: 10_000 });
    const verLine = ver.stdout.split("\n")[0]?.trim() ?? "unknown";
    checks.push({ id: "ffmpeg", ok: ver.code === 0, detail: `${verLine}（来源: ${ffmpeg.source}, 路径: ${ffmpeg.path}）` });

    const filters = await run(ffmpeg.path, ["-hide_banner", "-filters"], { timeoutMs: 10_000 });
    for (const f of ["subtitles", "drawtext", "xfade", "concat", "loudnorm"]) {
      const ok = new RegExp(`\\s${f}\\s`).test(filters.stdout);
      checks.push({
        id: `filter:${f}`,
        ok,
        detail: ok ? `滤镜 ${f} 可用` : `滤镜 ${f} 不可用`,
        ...(ok ? {} : { suggestion: "当前 FFmpeg 构建缺少该滤镜，请使用 full/gpl 构建（含 libass）" }),
      });
    }
  } else {
    checks.push({
      id: "ffmpeg",
      ok: false,
      detail: "找不到 ffmpeg",
      suggestion: "安装 FFmpeg（winget install Gyan.FFmpeg）或设置 QC_FFMPEG_PATH 指向其目录",
    });
  }

  const ffprobe = resolveTool("ffprobe");
  checks.push(
    ffprobe
      ? { id: "ffprobe", ok: true, detail: `来源: ${ffprobe.source}, 路径: ${ffprobe.path}` }
      : { id: "ffprobe", ok: false, detail: "找不到 ffprobe", suggestion: "ffprobe 通常与 ffmpeg 同目录分发" },
  );

  if (process.platform === "win32") {
    const fontsDir = join(process.env["WINDIR"] ?? "C:\\Windows", "Fonts");
    const found = CJK_FONT_CANDIDATES.filter((f) => existsSync(join(fontsDir, f.file)));
    checks.push({
      id: "cjk-fonts",
      ok: found.length > 0,
      detail: found.length > 0 ? `中文字体可用: ${found.map((f) => f.name).join(", ")}` : "未找到常见中文字体",
      ...(found.length > 0 ? {} : { suggestion: "安装微软雅黑或在文字样式中指定其他已安装的中文字体" }),
    });
  }

  // 转写能力（可选）
  const whisper = resolveWhisper();
  checks.push(
    whisper
      ? { id: "whisper", ok: true, optional: true, detail: `whisper-cli 可用（来源: ${whisper.source}, 路径: ${whisper.cliPath}）` }
      : {
          id: "whisper",
          ok: false,
          optional: true,
          detail: "whisper-cli 未安装（转写功能不可用，其余功能不受影响）",
          suggestion: "运行 bun script/install-whisper.ts 安装",
        },
  );
  const model = resolveWhisperModel();
  checks.push(
    model
      ? { id: "whisper-model", ok: true, optional: true, detail: `默认模型: ${model}` }
      : {
          id: "whisper-model",
          ok: false,
          optional: true,
          detail: "whisper 默认模型缺失",
          suggestion: "运行 bun script/install-whisper.ts --model base（或 large-v3-turbo 获得更佳中文效果）",
        },
  );

  return {
    ok: checks.every((c) => c.ok || c.optional),
    platform: `${process.platform} ${process.arch}`,
    checks,
  };
}
