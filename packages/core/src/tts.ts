import { issue, type AudioClip, type Job, type QcIssue, type Track, type VideoClip } from "@qingchen/cut-dsl";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { run } from "./ffmpeg";
import { probeMedia } from "./probe";
import { validateJobFile } from "./validate";

export interface NarrationSegmentInput {
  id?: string;
  text: string;
}

export interface ParseNarrationScriptResult {
  ok: boolean;
  title?: string;
  segments?: NarrationSegmentInput[];
  issues: QcIssue[];
}

export interface SpeechOptions {
  text: string;
  outWav: string;
  provider?: "sapi";
  voice?: string;
  rate?: number;
  volume?: number;
}

export interface SpeechResult {
  ok: boolean;
  output?: string;
  durationSec?: number;
  voice?: string;
  issues: QcIssue[];
}

export interface NarrationSegment {
  id: string;
  text: string;
  audioPath: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface SynthesizeNarrationOptions {
  segments: NarrationSegmentInput[];
  outDir: string;
  baseName?: string;
  provider?: "sapi";
  voice?: string;
  rate?: number;
  volume?: number;
}

export interface SynthesizeNarrationResult {
  ok: boolean;
  segments?: NarrationSegment[];
  srtPath?: string;
  totalDurationSec?: number;
  voice?: string;
  issues: QcIssue[];
}

export interface CreateNarratedJobOptions {
  narration: SynthesizeNarrationResult;
  videoPath: string;
  bgmPath?: string;
  jobPath: string;
  outputPath: string;
  title?: string;
  project?: {
    name?: string;
    canvas?: { width: number; height: number };
    fps?: number;
    background?: string;
  };
}

export interface CreateNarratedJobResult {
  ok: boolean;
  job?: Job;
  jobPath?: string;
  outputPath?: string;
  totalDurationSec?: number;
  issues: QcIssue[];
}

function sanitizeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "narration";
}

function psString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const f = ms % 1000;
  const pad = (v: number, w = 2) => String(v).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(f, 3)}`;
}

function wrapSrtText(text: string, maxChars = 18): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  const lines: string[] = [];
  let rest = normalized;
  const punctuation = /[，。！？；：、,.!?;:]/;

  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    let cut = -1;
    for (let i = window.length - 1; i >= Math.floor(maxChars * 0.45); i--) {
      if (punctuation.test(window[i]!)) {
        cut = i + 1;
        break;
      }
    }
    if (cut < 0) cut = maxChars;
    if (rest[cut] && punctuation.test(rest[cut]!)) cut += 1;

    const line = rest.slice(0, cut).trim();
    if (line) lines.push(line);
    rest = rest.slice(cut).trim();

    while (rest && punctuation.test(rest[0]!)) {
      if (lines.length > 0) lines[lines.length - 1] += rest[0];
      rest = rest.slice(1).trim();
    }
  }
  if (rest) lines.push(rest);
  return lines.join("\n");
}

export function narrationSegmentsToSrt(segments: Pick<NarrationSegment, "startSec" | "endSec" | "text">[]): string {
  return (
    segments
      .map((seg, i) => `${i + 1}\n${srtTime(seg.startSec)} --> ${srtTime(seg.endSec)}\n${wrapSrtText(seg.text)}`)
      .join("\n\n") + "\n"
  );
}

function normalizeSegments(raw: unknown): NarrationSegmentInput[] | null {
  if (!Array.isArray(raw)) return null;
  const segments: NarrationSegmentInput[] = [];
  raw.forEach((item, i) => {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) segments.push({ id: `seg-${i + 1}`, text });
      return;
    }
    if (item && typeof item === "object" && typeof (item as any).text === "string") {
      const text = String((item as any).text).trim();
      if (text) {
        segments.push({
          id: typeof (item as any).id === "string" ? (item as any).id : `seg-${i + 1}`,
          text,
        });
      }
    }
  });
  return segments.length > 0 ? segments : null;
}

/** 解析文案：支持 JSON 数组、JSON 对象 {title, segments}，以及按空行/非空行切分的纯文本。 */
export function parseNarrationScript(text: string): ParseNarrationScriptResult {
  const source = text.trim();
  if (!source) {
    return { ok: false, issues: [issue("TTS_EMPTY_SCRIPT", "validate", "配音文案为空")] };
  }

  try {
    const raw = JSON.parse(source);
    const segments = normalizeSegments(Array.isArray(raw) ? raw : raw?.segments);
    if (!segments) {
      return {
        ok: false,
        issues: [
          issue("TTS_INVALID_SCRIPT", "validate", "JSON 文案必须是字符串数组，或包含 segments 数组的对象"),
        ],
      };
    }
    return {
      ok: true,
      title: typeof raw?.title === "string" && raw.title.trim() ? raw.title.trim() : undefined,
      segments,
      issues: [],
    };
  } catch {
    const segments = source
      .split(/\r?\n\s*\r?\n|\r?\n/)
      .map((line, i) => ({ id: `seg-${i + 1}`, text: line.trim() }))
      .filter((seg) => seg.text.length > 0);
    if (segments.length === 0) {
      return { ok: false, issues: [issue("TTS_EMPTY_SCRIPT", "validate", "配音文案没有可用段落")] };
    }
    return { ok: true, segments, issues: [] };
  }
}

/** Windows SAPI TTS：离线、无密钥，适合作为本地 P0 provider。 */
export async function synthesizeSpeech(opts: SpeechOptions): Promise<SpeechResult> {
  if ((opts.provider ?? "sapi") !== "sapi") {
    return { ok: false, issues: [issue("TTS_PROVIDER_UNSUPPORTED", "render", `不支持的 TTS provider: ${opts.provider}`)] };
  }
  if (process.platform !== "win32") {
    return {
      ok: false,
      issues: [issue("TTS_PROVIDER_UNAVAILABLE", "render", "SAPI TTS 仅在 Windows 可用")],
    };
  }
  if (!opts.text.trim()) {
    return { ok: false, issues: [issue("TTS_EMPTY_TEXT", "validate", "配音文本为空")] };
  }

  const outWav = resolve(opts.outWav);
  mkdirSync(dirname(outWav), { recursive: true });
  const tempDir = mkdtempSync(join(tmpdir(), "qc-tts-"));
  const textPath = join(tempDir, "input.txt");
  const scriptPath = join(tempDir, "sapi.ps1");
  writeFileSync(textPath, opts.text, "utf8");

  const rate = clamp(Math.round(opts.rate ?? 0), -10, 10);
  const volume = clamp(Math.round(opts.volume ?? 100), 0, 100);
  const voice = opts.voice?.trim() ?? "";
  const script = [
    "Add-Type -AssemblyName System.Speech",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    `$s.Rate = ${rate}`,
    `$s.Volume = ${volume}`,
    `$voice = ${psString(voice)}`,
    "if ($voice) {",
    "  $s.SelectVoice($voice)",
    "} else {",
    "  $preferred = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name } | Where-Object { $_ -match 'Huihui|Kangkang|Yaoyao|Microsoft.*Chinese' } | Select-Object -First 1",
    "  if ($preferred) { $s.SelectVoice($preferred) }",
    "}",
    `$text = Get-Content -Raw -LiteralPath ${psString(textPath)}`,
    `$s.SetOutputToWaveFile(${psString(outWav)})`,
    "$s.Speak($text) | Out-Null",
    "Write-Output $s.Voice.Name",
    "$s.Dispose()",
  ].join("\n");
  writeFileSync(scriptPath, script, "utf8");

  try {
    const result = await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
      timeoutMs: 120_000,
    });
    if (result.code !== 0 || !existsSync(outWav)) {
      return {
        ok: false,
        issues: [
          issue("TTS_SYNTHESIS_FAILED", "render", `SAPI 合成失败 (exit ${result.code}): ${result.stderr.slice(-800)}`),
        ],
      };
    }
    const probed = await probeMedia(outWav);
    if (!probed.info || probed.issues.length > 0) {
      return { ok: false, output: outWav, issues: probed.issues };
    }
    return {
      ok: true,
      output: outWav,
      durationSec: probed.info.durationSec,
      voice: result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1),
      issues: [],
    };
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响 TTS 结果
    }
  }
}

/** 批量分段配音：每段独立 WAV，真实时长回填为时间线与 SRT。 */
export async function synthesizeNarration(opts: SynthesizeNarrationOptions): Promise<SynthesizeNarrationResult> {
  const sourceSegments = opts.segments.map((s, i) => ({
    id: s.id?.trim() || `seg-${i + 1}`,
    text: s.text.trim(),
  }));
  if (sourceSegments.length === 0 || sourceSegments.some((s) => !s.text)) {
    return { ok: false, issues: [issue("TTS_EMPTY_SCRIPT", "validate", "配音文案没有可用段落")] };
  }

  const outDir = resolve(opts.outDir);
  const baseName = sanitizeName(opts.baseName ?? "narration");
  mkdirSync(outDir, { recursive: true });

  const segments: NarrationSegment[] = [];
  const issues: QcIssue[] = [];
  let cursor = 0;
  let selectedVoice: string | undefined;

  for (let i = 0; i < sourceSegments.length; i++) {
    const src = sourceSegments[i]!;
    const audioPath = join(outDir, `${baseName}-${String(i + 1).padStart(2, "0")}.wav`);
    const speech = await synthesizeSpeech({
      text: src.text,
      outWav: audioPath,
      provider: opts.provider ?? "sapi",
      voice: opts.voice,
      rate: opts.rate,
      volume: opts.volume,
    });
    if (!speech.ok || !speech.output || !speech.durationSec) {
      issues.push(...speech.issues);
      continue;
    }
    selectedVoice = selectedVoice ?? speech.voice;
    const durationSec = speech.durationSec;
    const seg: NarrationSegment = {
      id: src.id,
      text: src.text,
      audioPath: speech.output,
      startSec: cursor,
      endSec: cursor + durationSec,
      durationSec,
    };
    segments.push(seg);
    cursor = seg.endSec;
  }

  if (issues.length > 0) return { ok: false, segments, issues };

  const srtPath = join(outDir, `${baseName}.srt`);
  writeFileSync(srtPath, narrationSegmentsToSrt(segments), "utf8");
  return {
    ok: true,
    segments,
    srtPath,
    totalDurationSec: cursor,
    voice: selectedVoice,
    issues: [],
  };
}

function clipForDuration(durationSec: number, sourceDurationSec: number, cursorSec: number): {
  clip: VideoClip;
  nextCursorSec: number;
  issue?: QcIssue;
} {
  if (durationSec <= sourceDurationSec) {
    const start = cursorSec + durationSec <= sourceDurationSec ? cursorSec : 0;
    return {
      clip: { assetId: "visual", in: start, out: start + durationSec, speed: 1, fit: "cover", volume: 0.2 },
      nextCursorSec: start + durationSec,
    };
  }
  const speed = sourceDurationSec / durationSec;
  if (speed < 0.25) {
    return {
      clip: { assetId: "visual", in: 0, out: sourceDurationSec, speed: 0.25, fit: "cover", volume: 0.2 },
      nextCursorSec: 0,
      issue: issue("TTS_SEGMENT_TOO_LONG", "plan", `配音段落 ${durationSec.toFixed(3)}s 超过单段视频可拉伸范围`, {
        suggestion: "拆分文案段落，或提供更长的视频素材",
      }),
    };
  }
  return {
    clip: { assetId: "visual", in: 0, out: sourceDurationSec, speed, fit: "cover", volume: 0.2 },
    nextCursorSec: 0,
  };
}

/** 用配音分段真实时长生成可渲染 DSL：视频 clip、配音 audio、字幕 SRT、可选 BGM 同步到同一时间线。 */
export async function createNarratedJobFile(opts: CreateNarratedJobOptions): Promise<CreateNarratedJobResult> {
  if (!opts.narration.ok || !opts.narration.segments || !opts.narration.srtPath || !opts.narration.totalDurationSec) {
    return { ok: false, issues: opts.narration.issues };
  }
  const video = await probeMedia(opts.videoPath);
  if (!video.info || !video.info.video || video.issues.length > 0) {
    return { ok: false, issues: video.issues.length ? video.issues : [issue("DSL_ASSET_NO_VIDEO", "probe", "视频素材没有视频轨")] };
  }

  const issues: QcIssue[] = [];
  let cursor = 0;
  const videoClips = opts.narration.segments.map((seg) => {
    const picked = clipForDuration(seg.durationSec, video.info!.durationSec, cursor);
    cursor = picked.nextCursorSec;
    if (picked.issue) issues.push(picked.issue);
    return picked.clip;
  });
  if (issues.length > 0) return { ok: false, issues };

  const assets: Job["assets"] = [
    { id: "visual", path: resolve(opts.videoPath) },
    ...opts.narration.segments.map((seg, i) => ({ id: `voice-${i + 1}`, path: seg.audioPath })),
    ...(opts.bgmPath ? [{ id: "bgm", path: resolve(opts.bgmPath) }] : []),
  ];

  const audioClips: AudioClip[] = opts.narration.segments.map((seg, i) => ({
    assetId: `voice-${i + 1}`,
    start: seg.startSec,
    in: 0,
    duration: "auto",
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
  }));
  if (opts.bgmPath) {
    audioClips.push({
      assetId: "bgm",
      start: 0,
      in: 0,
      duration: "auto",
      volume: 0.18,
      fadeIn: 0.5,
      fadeOut: 1,
    });
  }

  const total = opts.narration.totalDurationSec;
  const tracks: Track[] = [{ id: "v1", type: "video", clips: videoClips }];
  if (opts.title) {
    tracks.push({
      id: "title",
      type: "text",
      clips: [
        {
          text: opts.title,
          start: 0,
          duration: Math.min(total, 4),
          style: {
            fontFamily: "Microsoft YaHei",
            fontSize: 82,
            color: "#ffffff",
            stroke: { color: "#000000", width: 4 },
            position: { x: 0.5, y: 0.13, anchor: "center" },
          },
        },
      ],
    });
  }
  tracks.push({ id: "subtitles", type: "subtitle", source: { srt: opts.narration.srtPath }, style: { preset: "default-bottom" } });
  tracks.push({ id: "audio", type: "audio", clips: audioClips });

  const job: Job = {
    version: 1,
    project: {
      name: opts.project?.name ?? sanitizeName(basename(opts.jobPath, ".json")),
      canvas: opts.project?.canvas ?? { width: 1080, height: 1920 },
      fps: opts.project?.fps ?? 30,
      background: opts.project?.background ?? "#101010",
    },
    assets,
    tracks,
    export: {
      format: "mp4",
      video: { codec: "h264", crf: 20, preset: "fast" },
      audio: { codec: "aac", bitrate: "192k" },
      output: resolve(opts.outputPath),
    },
  };

  const jobPath = resolve(opts.jobPath);
  mkdirSync(dirname(jobPath), { recursive: true });
  mkdirSync(dirname(resolve(opts.outputPath)), { recursive: true });
  writeFileSync(jobPath, JSON.stringify(job, null, 2) + "\n", "utf8");
  const validation = await validateJobFile(jobPath);
  return {
    ok: validation.ok,
    job,
    jobPath,
    outputPath: resolve(opts.outputPath),
    totalDurationSec: validation.totalDurationSec,
    issues: validation.issues,
  };
}
