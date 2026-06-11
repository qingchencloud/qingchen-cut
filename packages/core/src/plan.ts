import {
  clipVisibleDuration,
  videoTrackDuration,
  type AudioTrack,
  type Job,
  type SubtitleTrack,
  type TextClip,
  type VideoTrack,
} from "@qingchen/cut-dsl";
import { findFontFile } from "./fonts";
import type { MediaInfo } from "./probe";
import { resolveJobPath } from "./validate";

/**
 * DSL → FFmpeg 渲染计划编译器。
 * 输出确定性的 inputs + filtergraph，render/frame/plan 共用。
 *
 * 结构：
 * 1. 每个视频 clip 独立归一化（trim/变速/适配画布/统一 fps 与像素格式）
 * 2. 顺序两两合并：有 transitionOut 用 xfade+acrossfade，否则 concat
 * 3. 叠加 drawtext（文字轨）与 subtitles（字幕轨）
 * 4. 音频轨（BGM 等）处理后与主链 amix
 */

export interface RenderPlan {
  /** -i 输入文件列表，按序对应 input index */
  inputs: string[];
  filtergraph: string;
  /** 最终视频/音频流标号（含方括号） */
  videoLabel: string;
  audioLabel: string;
  /** 需要在渲染前写入临时目录的文本文件（drawtext textfile），path 为占位名 */
  textFiles: { name: string; content: string }[];
  totalDurationSec: number;
  outputPath: string;
  fps: number;
}

/** filtergraph 内的文件路径转义：统一正斜杠，转义冒号与单引号，再整体加单引号 */
export function escapeFilterPath(p: string): string {
  const normalized = p.replace(/\\/g, "/").replace(/'/g, "'\\''").replace(/:/g, "\\:");
  return `'${normalized}'`;
}

/** #RRGGBB → 0xRRGGBB（FFmpeg 颜色语法） */
function color(hex: string): string {
  return hex.replace(/^#/, "0x");
}

/** atempo 只支持 0.5~2.0，超出范围串联多个 */
function atempoChain(speed: number): string[] {
  const parts: string[] = [];
  let s = speed;
  while (s > 2) {
    parts.push("atempo=2.0");
    s /= 2;
  }
  while (s < 0.5) {
    parts.push("atempo=0.5");
    s *= 2;
  }
  if (Math.abs(s - 1) > 1e-9) parts.push(`atempo=${s}`);
  return parts;
}

function fitFilters(fit: "contain" | "cover" | "stretch", w: number, h: number, bg: string): string[] {
  switch (fit) {
    case "contain":
      return [
        `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${color(bg)}`,
      ];
    case "cover":
      return [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`];
    case "stretch":
      return [`scale=${w}:${h}`];
  }
}

/** drawtext 的 x/y 表达式：归一化坐标 + 锚点 */
function textPosition(clip: TextClip): { x: string; y: string } {
  const { x, y, anchor } = clip.style.position;
  const px = `(w*${x})`;
  const py = `(h*${y})`;
  switch (anchor) {
    case "center":
      return { x: `${px}-text_w/2`, y: `${py}-text_h/2` };
    case "top":
      return { x: `${px}-text_w/2`, y: py };
    case "bottom":
      return { x: `${px}-text_w/2`, y: `${py}-text_h` };
    case "left":
      return { x: px, y: `${py}-text_h/2` };
    case "right":
      return { x: `${px}-text_w`, y: `${py}-text_h/2` };
  }
}

export interface CompileContext {
  jobDir: string;
  assetInfo: Record<string, MediaInfo>;
  /** 渲染时临时目录的实际路径；plan 阶段可用占位符 */
  tempDir: string;
}

export interface CompileOptions {
  /** 只编译图像链路（抽帧用），跳过全部音频处理 */
  videoOnly?: boolean;
}

export function compilePlan(job: Job, ctx: CompileContext, opts: CompileOptions = {}): RenderPlan {
  const videoOnly = opts.videoOnly ?? false;
  const { width, height } = job.project.canvas;
  const fps = job.project.fps;
  const bg = job.project.background;
  const assetPath = new Map(job.assets.map((a) => [a.id, resolveJobPath(ctx.jobDir, a.path)]));

  const videoTrack = job.tracks.find((t): t is VideoTrack => t.type === "video")!;
  const textTracks = job.tracks.filter((t) => t.type === "text");
  const subtitleTracks = job.tracks.filter((t): t is SubtitleTrack => t.type === "subtitle");
  const audioTracks = job.tracks.filter((t): t is AudioTrack => t.type === "audio");
  const totalDurationSec = videoTrackDuration(videoTrack);

  const inputs: string[] = [];
  const chains: string[] = [];
  const textFiles: { name: string; content: string }[] = [];

  const addInput = (p: string): number => {
    inputs.push(p);
    return inputs.length - 1;
  };

  // —— 1. 每个视频 clip 归一化 ——
  const clipLabels: { v: string; a: string; dur: number }[] = [];
  videoTrack.clips.forEach((clip, i) => {
    const idx = addInput(assetPath.get(clip.assetId)!);
    const info = ctx.assetInfo[clip.assetId];
    const dur = clipVisibleDuration(clip);

    const vFilters = [
      `trim=start=${clip.in}:end=${clip.out}`,
      `setpts=(PTS-STARTPTS)/${clip.speed}`,
      ...fitFilters(clip.fit, width, height, bg),
      `fps=${fps}`,
      "setsar=1",
      "format=yuv420p",
    ];
    chains.push(`[${idx}:v]${vFilters.join(",")}[cv${i}]`);

    // 音频：素材无音轨时用静音补齐，保证 concat/acrossfade 输入对称
    if (videoOnly) {
      // 抽帧模式不建音频链
    } else if (info && info.audio.length > 0) {
      const aFilters = [
        `atrim=start=${clip.in}:end=${clip.out}`,
        "asetpts=PTS-STARTPTS",
        ...atempoChain(clip.speed),
        `volume=${clip.volume}`,
        "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo",
      ];
      chains.push(`[${idx}:a]${aFilters.join(",")}[ca${i}]`);
    } else {
      chains.push(
        `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${dur},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[ca${i}]`,
      );
    }
    clipLabels.push({ v: `[cv${i}]`, a: `[ca${i}]`, dur });
  });

  // —— 2. 顺序合并（xfade / concat） ——
  let acc = clipLabels[0]!;
  let accDur = acc.dur;
  let mergeIdx = 0;
  for (let i = 1; i < clipLabels.length; i++) {
    const next = clipLabels[i]!;
    const prevClip = videoTrack.clips[i - 1]!;
    const t = prevClip.transitionOut;
    const vOut = `[mv${mergeIdx}]`;
    const aOut = `[ma${mergeIdx}]`;
    if (t) {
      const offset = accDur - t.duration;
      chains.push(`${acc.v}${next.v}xfade=transition=fade:duration=${t.duration}:offset=${offset}${vOut}`);
      if (!videoOnly) chains.push(`${acc.a}${next.a}acrossfade=d=${t.duration}${aOut}`);
      accDur = accDur + next.dur - t.duration;
    } else {
      chains.push(`${acc.v}${next.v}concat=n=2:v=1:a=0${vOut}`);
      if (!videoOnly) chains.push(`${acc.a}${next.a}concat=n=2:v=0:a=1${aOut}`);
      accDur += next.dur;
    }
    acc = { v: vOut, a: aOut, dur: accDur };
    mergeIdx++;
  }

  let vLabel = acc.v;
  let aLabel = acc.a;
  let stage = 0;

  // —— 3. 文字轨（drawtext，textfile 规避转义问题） ——
  textTracks.forEach((track) => {
    if (track.type !== "text") return;
    track.clips.forEach((clip, c) => {
      const name = `text-${textFiles.length}.txt`;
      textFiles.push({ name, content: clip.text });
      const pos = textPosition(clip);
      // 多行文本逐行对齐（FFmpeg 7+ 的 text_align）；锚点在左/右时跟随，否则居中
      const align =
        clip.style.position.anchor === "left" ? "L" : clip.style.position.anchor === "right" ? "R" : "C";
      const fontFile = findFontFile(clip.style.fontFamily);
      const fontOpt = fontFile
        ? `fontfile=${escapeFilterPath(fontFile)}`
        : `font='${clip.style.fontFamily.replace(/'/g, "")}'`;
      const opts = [
        `textfile=${escapeFilterPath(`${ctx.tempDir}/${name}`)}`,
        fontOpt,
        `fontsize=${clip.style.fontSize}`,
        `fontcolor=${color(clip.style.color)}`,
        `text_align=${align}`,
        ...(clip.style.stroke
          ? [`borderw=${clip.style.stroke.width}`, `bordercolor=${color(clip.style.stroke.color)}`]
          : []),
        `x=${pos.x}`,
        `y=${pos.y}`,
        `enable='between(t,${clip.start},${clip.start + clip.duration})'`,
      ];
      const out = `[tv${stage}]`;
      chains.push(`${vLabel}drawtext=${opts.join(":")}${out}`);
      vLabel = out;
      stage++;
    });
  });

  // —— 4. 字幕轨（subtitles 滤镜烧录） ——
  subtitleTracks.forEach((track) => {
    const srcPath = resolveJobPath(ctx.jobDir, "srt" in track.source ? track.source.srt : track.source.ass);
    const opts = [`filename=${escapeFilterPath(srcPath)}`];
    if ("srt" in track.source) {
      opts.push(`force_style='FontName=Microsoft YaHei,Outline=1,Shadow=0,MarginV=40'`);
    }
    const out = `[sv${stage}]`;
    chains.push(`${vLabel}subtitles=${opts.join(":")}${out}`);
    vLabel = out;
    stage++;
  });

  // —— 5. 音频轨（BGM/音效）amix ——
  const bgmLabels: string[] = [];
  if (!videoOnly) audioTracks.forEach((track, ti) => {
    track.clips.forEach((clip, ci) => {
      const idx = addInput(assetPath.get(clip.assetId)!);
      const info = ctx.assetInfo[clip.assetId];
      const assetDur = info?.durationSec ?? 0;
      const dur =
        clip.duration === "auto"
          ? Math.max(0.01, Math.min(assetDur - clip.in, totalDurationSec - clip.start))
          : clip.duration;
      const filters = [
        `atrim=start=${clip.in}:end=${clip.in + dur}`,
        "asetpts=PTS-STARTPTS",
        `volume=${clip.volume}`,
        ...(clip.fadeIn > 0 ? [`afade=t=in:st=0:d=${clip.fadeIn}`] : []),
        ...(clip.fadeOut > 0 ? [`afade=t=out:st=${Math.max(0, dur - clip.fadeOut)}:d=${clip.fadeOut}`] : []),
        "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo",
        ...(clip.start > 0 ? [`adelay=${Math.round(clip.start * 1000)}:all=1`] : []),
      ];
      const label = `[bgm${ti}_${ci}]`;
      chains.push(`[${idx}:a]${filters.join(",")}${label}`);
      bgmLabels.push(label);
    });
  });
  if (bgmLabels.length > 0) {
    const out = "[amixed]";
    chains.push(
      `${aLabel}${bgmLabels.join("")}amix=inputs=${bgmLabels.length + 1}:duration=first:normalize=0${out}`,
    );
    aLabel = out;
  }

  return {
    inputs,
    filtergraph: chains.join(";\n"),
    videoLabel: vLabel,
    audioLabel: aLabel,
    textFiles,
    totalDurationSec,
    outputPath: resolveJobPath(ctx.jobDir, job.export.output),
    fps,
  };
}

/** 组装 render 用的完整 ffmpeg 参数（不含 exe 路径） */
export function buildRenderArgs(job: Job, plan: RenderPlan, filterScriptPath: string): string[] {
  return [
    "-y",
    "-hide_banner",
    ...plan.inputs.flatMap((p) => ["-i", p]),
    "-filter_complex_script", filterScriptPath,
    "-map", plan.videoLabel,
    "-map", plan.audioLabel,
    "-c:v", "libx264",
    "-crf", String(job.export.video.crf),
    "-preset", job.export.video.preset,
    "-r", String(plan.fps),
    "-c:a", "aac",
    "-b:a", job.export.audio.bitrate,
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-nostats",
    plan.outputPath,
  ];
}

/** 组装单帧抽取参数：渲染同一条图像链路，在 atSec 处取一帧 PNG */
export function buildFrameArgs(plan: RenderPlan, filterScriptPath: string, atSec: number, outPng: string): string[] {
  return [
    "-y",
    "-hide_banner",
    ...plan.inputs.flatMap((p) => ["-i", p]),
    "-filter_complex_script", filterScriptPath,
    "-map", plan.videoLabel,
    "-ss", String(atSec),
    "-frames:v", "1",
    outPng,
  ];
}
