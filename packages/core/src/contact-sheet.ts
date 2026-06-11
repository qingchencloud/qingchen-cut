import { issue, type QcIssue } from "@qingchen/cut-dsl";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveTool, run } from "./ffmpeg";
import { findFontFile } from "./fonts";
import { escapeFilterPath } from "./plan";
import { probeMedia } from "./probe";
import { prepareJob } from "./render";

export interface ContactSheetOptions {
  cols?: number;
  rows?: number;
  /** 单格宽度（像素） */
  tileWidth?: number;
}

export interface ContactSheetResult {
  ok: boolean;
  output?: string;
  /** 网格中每格对应的时间点（秒），按行优先顺序 */
  frameTimesSec?: number[];
  issues: QcIssue[];
}

/** 每格左上角叠加时间戳，AI 看图即可知道每格对应成片的哪一秒 */
function timestampFilter(): string {
  const fontFile = findFontFile("Arial") ?? findFontFile("Microsoft YaHei");
  const fontOpt = fontFile ? `:fontfile=${escapeFilterPath(fontFile)}` : "";
  return `drawtext=text='%{pts\\:hms}'${fontOpt}:fontsize=22:fontcolor=white:borderw=2:bordercolor=black:x=8:y=8`;
}

/**
 * 生成九宫格（默认 3x3）缩略图。target 为 .json 时按 DSL 编译后的成片取帧，
 * 否则直接对媒体文件取帧。一张图看全片节奏，供 AI 快速审片。
 */
export async function contactSheet(
  target: string,
  outPng: string,
  opts: ContactSheetOptions = {},
): Promise<ContactSheetResult> {
  const cols = opts.cols ?? 3;
  const rows = opts.rows ?? 3;
  const tileWidth = opts.tileWidth ?? 320;
  const n = cols * rows;

  const ffmpeg = resolveTool("ffmpeg");
  if (!ffmpeg) {
    return { ok: false, issues: [issue("FFMPEG_NOT_FOUND", "probe", "找不到 ffmpeg", { suggestion: "运行 qc doctor" })] };
  }

  mkdirSync(dirname(resolve(outPng)), { recursive: true });
  const tail = `fps=${n}/%DUR%,${timestampFilter()},scale=${tileWidth}:-2,tile=${cols}x${rows}`;

  let args: string[];
  let durationSec: number;
  let tempDir: string | null = null;
  let baseIssues: QcIssue[] = [];

  if (/\.json$/i.test(target)) {
    const prepared = await prepareJob(target, { videoOnly: true });
    if (!("plan" in prepared)) return { ok: false, issues: prepared.issues };
    const { plan, filterScriptPath } = prepared;
    tempDir = prepared.tempDir;
    baseIssues = prepared.issues;
    durationSec = plan.totalDurationSec;
    // 在已编译图像链路末尾追加取帧+拼格
    const sheetGraph = `${plan.filtergraph};\n${plan.videoLabel}${tail.replace("%DUR%", String(durationSec))}[sheet]`;
    writeFileSync(filterScriptPath, sheetGraph, "utf8");
    args = [
      "-y", "-hide_banner",
      ...plan.inputs.flatMap((p) => ["-i", p]),
      "-filter_complex_script", filterScriptPath,
      "-map", "[sheet]",
      "-frames:v", "1",
      outPng,
    ];
  } else {
    const probed = await probeMedia(target);
    if (!probed.info) return { ok: false, issues: probed.issues };
    if (!probed.info.video) {
      return {
        ok: false,
        issues: [issue("ANALYZE_NO_VIDEO", "probe", `${target} 没有视频轨，无法生成缩略图`)],
      };
    }
    durationSec = probed.info.durationSec;
    tempDir = mkdtempSync(join(tmpdir(), "qc-sheet-"));
    const scriptPath = join(tempDir, "filtergraph.txt");
    writeFileSync(scriptPath, `[0:v]${tail.replace("%DUR%", String(durationSec))}[sheet]`, "utf8");
    args = [
      "-y", "-hide_banner",
      "-i", target,
      "-filter_complex_script", scriptPath,
      "-map", "[sheet]",
      "-frames:v", "1",
      outPng,
    ];
  }

  const result = await run(ffmpeg.path, args, { timeoutMs: 600_000 });
  const ok = result.code === 0 && existsSync(outPng);
  if (tempDir) {
    try {
      if (ok) rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响结果
    }
  }
  if (!ok) {
    return {
      ok: false,
      issues: [
        ...baseIssues,
        issue("SHEET_FAILED", "probe", `缩略图生成失败 (exit ${result.code}): ${result.stderr.slice(-800)}`, {
          suggestion: tempDir ? `临时目录已保留: ${tempDir}` : undefined,
        }),
      ],
    };
  }

  const interval = durationSec / n;
  const frameTimesSec = Array.from({ length: n }, (_, i) => Math.round(i * interval * 1000) / 1000);
  return { ok: true, output: resolve(outPng), frameTimesSec, issues: baseIssues };
}
