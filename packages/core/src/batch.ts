import type { QcIssue } from "@qingchen/cut-dsl";
import { renderJob, type RenderProgress } from "./render";

/**
 * 批量渲染：顺序执行多个 job，单个失败不中断整批。
 * 顺序而非并行——FFmpeg 渲染本身吃满多核，并行只会互相拖慢。
 */

export interface BatchJobResult {
  jobPath: string;
  ok: boolean;
  output?: string;
  elapsedMs?: number;
  issues: QcIssue[];
}

export interface BatchResult {
  ok: boolean;
  total: number;
  succeeded: number;
  failed: number;
  elapsedMs: number;
  jobs: BatchJobResult[];
}

export interface BatchOptions {
  onJobStart?: (jobPath: string, index: number, total: number) => void;
  onJobProgress?: (jobPath: string, p: RenderProgress) => void;
  onJobDone?: (result: BatchJobResult) => void;
}

export async function renderBatch(jobPaths: string[], opts: BatchOptions = {}): Promise<BatchResult> {
  const started = Date.now();
  const jobs: BatchJobResult[] = [];
  for (let i = 0; i < jobPaths.length; i++) {
    const jobPath = jobPaths[i]!;
    opts.onJobStart?.(jobPath, i, jobPaths.length);
    const r = await renderJob(jobPath, {
      onProgress: (p) => opts.onJobProgress?.(jobPath, p),
    });
    const result: BatchJobResult = {
      jobPath,
      ok: r.ok,
      ...(r.output ? { output: r.output } : {}),
      ...(r.elapsedMs !== undefined ? { elapsedMs: r.elapsedMs } : {}),
      issues: r.issues,
    };
    jobs.push(result);
    opts.onJobDone?.(result);
  }
  const succeeded = jobs.filter((j) => j.ok).length;
  return {
    ok: succeeded === jobs.length && jobs.length > 0,
    total: jobs.length,
    succeeded,
    failed: jobs.length - succeeded,
    elapsedMs: Date.now() - started,
    jobs,
  };
}
