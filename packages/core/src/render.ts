import { issue, type Job, type QcIssue } from "@qingchen/cut-dsl";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveTool, run } from "./ffmpeg";
import { buildFrameArgs, buildRenderArgs, compilePlan, type RenderPlan } from "./plan";
import { validateJobFile } from "./validate";

export interface RenderProgress {
  stage: "render";
  outTimeSec: number;
  percent: number;
}

export interface RenderResult {
  ok: boolean;
  output?: string;
  durationSec?: number;
  sizeBytes?: number;
  elapsedMs?: number;
  issues: QcIssue[];
}

export interface Prepared {
  job: Job;
  plan: RenderPlan;
  tempDir: string;
  filterScriptPath: string;
  issues: QcIssue[];
}

/** 校验 + 编译 + 写临时文件（filtergraph 脚本、drawtext 文本） */
export async function prepareJob(
  jobFilePath: string,
  compileOpts: { videoOnly?: boolean } = {},
): Promise<Prepared | { issues: QcIssue[] }> {
  const validated = await validateJobFile(jobFilePath);
  if (!validated.ok || !validated.job) {
    return { issues: validated.issues };
  }
  const tempDir = mkdtempSync(join(tmpdir(), "qc-render-"));
  const plan = compilePlan(
    validated.job,
    {
      jobDir: dirname(resolve(jobFilePath)),
      assetInfo: validated.assetInfo ?? {},
      tempDir,
    },
    compileOpts,
  );
  for (const tf of plan.textFiles) {
    writeFileSync(join(tempDir, tf.name), tf.content, "utf8");
  }
  const filterScriptPath = join(tempDir, "filtergraph.txt");
  writeFileSync(filterScriptPath, plan.filtergraph, "utf8");
  mkdirSync(dirname(plan.outputPath), { recursive: true });
  return { job: validated.job, plan, tempDir, filterScriptPath, issues: validated.issues };
}

function cleanupTemp(tempDir: string, keep: boolean): void {
  if (keep) return;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // 临时目录清理失败不影响渲染结果
  }
}

export interface RenderOptions {
  onProgress?: (p: RenderProgress) => void;
  /** 失败时保留临时目录便于排查 */
  keepTemp?: boolean;
}

/** 渲染整个 job 到 MP4 */
export async function renderJob(jobFilePath: string, opts: RenderOptions = {}): Promise<RenderResult> {
  const prepared = await prepareJob(jobFilePath);
  if (!("plan" in prepared)) return { ok: false, issues: prepared.issues };
  const { job, plan, tempDir, filterScriptPath, issues } = prepared;

  const ffmpeg = resolveTool("ffmpeg");
  if (!ffmpeg) {
    cleanupTemp(tempDir, false);
    return {
      ok: false,
      issues: [...issues, issue("FFMPEG_NOT_FOUND", "render", "找不到 ffmpeg", { suggestion: "运行 qc doctor" })],
    };
  }

  const args = buildRenderArgs(job, plan, filterScriptPath);
  const started = Date.now();
  let lastOutUs = 0;

  // -progress pipe:1 输出 key=value 行；stdout 解析进度
  const { spawn } = await import("node:child_process");
  const result = await new Promise<{ code: number; stderr: string }>((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpeg.path, args, { windowsHide: true });
    let stderr = "";
    let stdoutBuf = "";
    child.stdout.on("data", (d: Buffer) => {
      stdoutBuf += d.toString("utf8");
      let nl: number;
      while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        const m = /^out_time_us=(\d+)/.exec(line);
        if (m) {
          lastOutUs = Number(m[1]);
          const outTimeSec = lastOutUs / 1e6;
          opts.onProgress?.({
            stage: "render",
            outTimeSec: Math.round(outTimeSec * 100) / 100,
            percent: Math.min(100, Math.round((outTimeSec / plan.totalDurationSec) * 1000) / 10),
          });
        }
      }
    });
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code: code ?? -1, stderr }));
  });

  if (result.code !== 0 || !existsSync(plan.outputPath)) {
    cleanupTemp(tempDir, opts.keepTemp ?? true); // 失败默认保留现场
    return {
      ok: false,
      issues: [
        ...issues,
        issue("RENDER_FAILED", "render", `ffmpeg 渲染失败 (exit ${result.code}): ${result.stderr.slice(-1200)}`, {
          suggestion: `临时目录已保留: ${tempDir}（filtergraph.txt 可直接排查）`,
        }),
      ],
    };
  }

  cleanupTemp(tempDir, opts.keepTemp ?? false);
  return {
    ok: true,
    output: plan.outputPath,
    durationSec: plan.totalDurationSec,
    sizeBytes: statSync(plan.outputPath).size,
    elapsedMs: Date.now() - started,
    issues,
  };
}

export interface PlanResult {
  ok: boolean;
  totalDurationSec?: number;
  output?: string;
  inputs?: string[];
  filtergraph?: string;
  ffmpegArgs?: string[];
  issues: QcIssue[];
}

/** dry-run：输出将要执行的渲染计划，不实际渲染 */
export async function planJob(jobFilePath: string): Promise<PlanResult> {
  const prepared = await prepareJob(jobFilePath);
  if (!("plan" in prepared)) return { ok: false, issues: prepared.issues };
  const { job, plan, tempDir, filterScriptPath, issues } = prepared;
  const args = buildRenderArgs(job, plan, filterScriptPath);
  cleanupTemp(tempDir, false);
  return {
    ok: true,
    totalDurationSec: plan.totalDurationSec,
    output: plan.outputPath,
    inputs: plan.inputs,
    filtergraph: plan.filtergraph,
    ffmpegArgs: args,
    issues,
  };
}

export interface FrameResult {
  ok: boolean;
  output?: string;
  atSec?: number;
  issues: QcIssue[];
}

/** 抽取成片任意时间点的单帧 PNG，供 AI 视觉复核 */
export async function extractFrame(jobFilePath: string, atSec: number, outPng: string): Promise<FrameResult> {
  const prepared = await prepareJob(jobFilePath, { videoOnly: true });
  if (!("plan" in prepared)) return { ok: false, issues: prepared.issues };
  const { plan, tempDir, filterScriptPath, issues } = prepared;

  if (atSec >= plan.totalDurationSec) {
    cleanupTemp(tempDir, false);
    return {
      ok: false,
      issues: [
        ...issues,
        issue("FRAME_OUT_OF_RANGE", "render", `抽帧时间 ${atSec}s 超出成片总时长 ${plan.totalDurationSec.toFixed(3)}s`, {
          suggestion: `选择 0 ~ ${plan.totalDurationSec.toFixed(3)} 之间的时间点`,
        }),
      ],
    };
  }

  const ffmpeg = resolveTool("ffmpeg");
  if (!ffmpeg) {
    cleanupTemp(tempDir, false);
    return { ok: false, issues: [issue("FFMPEG_NOT_FOUND", "render", "找不到 ffmpeg")] };
  }

  mkdirSync(dirname(resolve(outPng)), { recursive: true });
  const result = await run(ffmpeg.path, buildFrameArgs(plan, filterScriptPath, atSec, outPng), {
    timeoutMs: 300_000,
  });
  const ok = result.code === 0 && existsSync(outPng);
  cleanupTemp(tempDir, !ok); // 失败保留现场，成功清理
  if (!ok) {
    return {
      ok: false,
      issues: [
        ...issues,
        issue("FRAME_FAILED", "render", `抽帧失败 (exit ${result.code}): ${result.stderr.slice(-800)}`),
      ],
    };
  }
  return { ok: true, output: resolve(outPng), atSec, issues };
}
