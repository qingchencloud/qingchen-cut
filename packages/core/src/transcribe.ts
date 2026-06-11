import { issue, type QcIssue } from "@qingchen/cut-dsl";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { resolveTool, resolveVendoredBin, run } from "./ffmpeg";
import { probeMedia } from "./probe";

/**
 * 本地语音转写。可插拔 provider 设计：当前实现 whisper.cpp，
 * 未来接其他引擎只需新增 provider，调用方接口不变。
 */

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export interface TranscribeResult {
  ok: boolean;
  language?: string;
  segments?: TranscriptSegment[];
  /** 全文（segments 拼接） */
  text?: string;
  /** 写出的 SRT 路径（传了 outSrt 时） */
  srt?: string;
  elapsedMs?: number;
  issues: QcIssue[];
}

export interface TranscribeOptions {
  /** 模型名（base/small/medium/large-v3-turbo…，找 vendor/models/ggml-<名>.bin）或模型文件完整路径 */
  model?: string;
  /** 语言代码（zh/en/…），默认 auto */
  language?: string;
  /** 顺带写出 SRT 字幕文件 */
  outSrt?: string;
  /** 引导提示词；中文默认用简体提示，避免输出繁体 */
  initialPrompt?: string;
}

export interface ResolvedWhisper {
  cliPath: string;
  source: "env" | "vendor" | "system-path";
}

/** 候选 vendor 根：当前工作目录与本包所在仓库根（兼容不同 cwd 调用） */
function vendorRoots(): string[] {
  const pkgRoot = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..", "..");
  return [process.cwd(), pkgRoot];
}

export function resolveWhisper(): ResolvedWhisper | null {
  const exe = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";

  const envPath = process.env["QC_WHISPER_PATH"];
  if (envPath && existsSync(envPath)) {
    const p = statSync(envPath).isDirectory() ? join(envPath, exe) : envPath;
    if (existsSync(p)) return { cliPath: p, source: "env" };
  }

  for (const root of vendorRoots()) {
    const p = join(root, "vendor", "whisper", exe);
    if (existsSync(p)) return { cliPath: p, source: "vendor" };
  }

  const vendoredNpm = resolveVendoredBin(
    ["@qingchen/whisper-win32-x64", "@qq1186258278/whisper-win32-x64"],
    exe,
  );
  if (vendoredNpm) return { cliPath: vendoredNpm, source: "vendor" };

  const fromPath = typeof Bun !== "undefined" ? Bun.which("whisper-cli") : null;
  if (fromPath) return { cliPath: fromPath, source: "system-path" };
  return null;
}

export function resolveWhisperModel(model?: string): string | null {
  const name = model ?? process.env["QC_WHISPER_MODEL"] ?? "base";
  if (isAbsolute(name) || /[/\\]/.test(name)) {
    return existsSync(name) ? resolve(name) : null;
  }
  for (const root of vendorRoots()) {
    const p = join(root, "vendor", "models", `ggml-${name}.bin`);
    if (existsSync(p)) return p;
  }
  return null;
}

function msToSrtTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const f = Math.round(ms % 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(f, 3)}`;
}

export function segmentsToSrt(segments: TranscriptSegment[]): string {
  return (
    segments
      .map(
        (seg, i) =>
          `${i + 1}\n${msToSrtTime(seg.startSec * 1000)} --> ${msToSrtTime(seg.endSec * 1000)}\n${seg.text.trim()}`,
      )
      .join("\n\n") + "\n"
  );
}

/** whisper.cpp 转写：媒体 → 16kHz 单声道 wav → whisper-cli JSON → 结构化结果 */
export async function transcribeMedia(mediaPath: string, opts: TranscribeOptions = {}): Promise<TranscribeResult> {
  const probed = await probeMedia(mediaPath);
  if (!probed.info) return { ok: false, issues: probed.issues };
  if (probed.info.audio.length === 0) {
    return {
      ok: false,
      issues: [issue("DSL_ASSET_NO_AUDIO", "probe", `${mediaPath} 没有音频轨，无法转写`)],
    };
  }

  const whisper = resolveWhisper();
  if (!whisper) {
    return {
      ok: false,
      issues: [
        issue("WHISPER_NOT_FOUND", "probe", "找不到 whisper-cli", {
          suggestion: "运行 bun script/install-whisper.ts 下载 whisper.cpp，或设置 QC_WHISPER_PATH",
        }),
      ],
    };
  }
  const modelPath = resolveWhisperModel(opts.model);
  if (!modelPath) {
    return {
      ok: false,
      issues: [
        issue("WHISPER_MODEL_NOT_FOUND", "probe", `找不到 whisper 模型: ${opts.model ?? "base"}`, {
          suggestion:
            "运行 bun script/install-whisper.ts --model <名> 下载到 vendor/models/，或传入模型文件完整路径",
        }),
      ],
    };
  }
  const ffmpeg = resolveTool("ffmpeg");
  if (!ffmpeg) {
    return { ok: false, issues: [issue("FFMPEG_NOT_FOUND", "probe", "找不到 ffmpeg", { suggestion: "运行 qc doctor" })] };
  }

  const started = Date.now();
  const tempDir = mkdtempSync(join(tmpdir(), "qc-whisper-"));
  try {
    // whisper.cpp 只吃 16kHz 单声道 wav
    const wavPath = join(tempDir, "audio.wav");
    const conv = await run(
      ffmpeg.path,
      ["-y", "-hide_banner", "-loglevel", "error", "-i", mediaPath, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath],
      { timeoutMs: 600_000 },
    );
    if (conv.code !== 0) {
      return { ok: false, issues: [issue("TRANSCRIBE_CONVERT_FAILED", "probe", `音频预处理失败: ${conv.stderr.slice(-400)}`)] };
    }

    const language = opts.language ?? "auto";
    const prompt = opts.initialPrompt ?? (language === "zh" ? "以下是普通话的句子，使用简体中文。" : undefined);
    const outBase = join(tempDir, "result");
    const args = [
      "-m", modelPath,
      "-f", wavPath,
      "-l", language,
      "-oj",
      "-of", outBase,
      "--no-prints",
      ...(prompt ? ["--prompt", prompt] : []),
    ];
    const trans = await run(whisper.cliPath, args, { timeoutMs: 3_600_000 });
    const jsonPath = `${outBase}.json`;
    if (trans.code !== 0 || !existsSync(jsonPath)) {
      return {
        ok: false,
        issues: [issue("TRANSCRIBE_FAILED", "probe", `whisper-cli 失败 (exit ${trans.code}): ${trans.stderr.slice(-600)}`)],
      };
    }

    const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
    const segments: TranscriptSegment[] = (raw.transcription ?? [])
      .map((t: any) => ({
        startSec: Number(t.offsets?.from ?? 0) / 1000,
        endSec: Number(t.offsets?.to ?? 0) / 1000,
        text: String(t.text ?? "").trim(),
      }))
      .filter((s: TranscriptSegment) => s.text.length > 0);

    const result: TranscribeResult = {
      ok: true,
      language: String(raw.result?.language ?? language),
      segments,
      text: segments.map((s) => s.text).join("\n"),
      elapsedMs: Date.now() - started,
      issues: [],
    };

    if (opts.outSrt) {
      const srtPath = resolve(opts.outSrt);
      mkdirSync(dirname(srtPath), { recursive: true });
      writeFileSync(srtPath, segmentsToSrt(segments), "utf8");
      result.srt = srtPath;
    }
    return result;
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响结果
    }
  }
}
