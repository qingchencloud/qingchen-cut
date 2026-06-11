import { applyPatch, hasErrors, parseJob, type PatchOp, type QcIssue } from "@qingchen/cut-dsl";
import { issue } from "@qingchen/cut-dsl";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { validateJobFile } from "./validate";

export interface PatchFileResult {
  ok: boolean;
  /** patch 后的完整 DSL（dry-run 时供预览） */
  job?: unknown;
  written?: boolean;
  issues: QcIssue[];
}

export interface PatchFileOptions {
  /** 只校验不落盘 */
  dryRun?: boolean;
}

/**
 * 对 job 文件应用 JSON Patch：解析 → 应用 → schema/语义校验 → 通过才写回。
 * 校验失败时不落盘，返回 issues 让 AI 修正 ops。
 */
export async function patchJobFile(
  jobFilePath: string,
  ops: PatchOp[],
  opts: PatchFileOptions = {},
): Promise<PatchFileResult> {
  if (!existsSync(jobFilePath)) {
    return {
      ok: false,
      issues: [issue("FS_JOB_NOT_FOUND", "validate", `job 文件不存在: ${jobFilePath}`)],
    };
  }
  let original: unknown;
  try {
    original = JSON.parse(readFileSync(jobFilePath, "utf8"));
  } catch (e) {
    return {
      ok: false,
      issues: [issue("DSL_JSON_SYNTAX", "validate", `job 文件 JSON 语法错误: ${(e as Error).message}`)],
    };
  }

  const patched = applyPatch(original, ops);
  if (!patched.doc || hasErrors(patched.issues)) {
    return { ok: false, issues: patched.issues };
  }

  // 先做纯校验（schema+语义），不通过不写盘
  const parsed = parseJob(patched.doc);
  if (!parsed.job || hasErrors(parsed.issues)) {
    return { ok: false, job: patched.doc, issues: parsed.issues };
  }

  if (opts.dryRun) {
    return { ok: true, job: patched.doc, written: false, issues: parsed.issues };
  }

  writeFileSync(jobFilePath, JSON.stringify(patched.doc, null, 2) + "\n", "utf8");

  // 落盘后跑完整校验（含文件存在性与 ffprobe），把潜在问题一并带回
  const full = await validateJobFile(jobFilePath);
  return { ok: full.ok, job: patched.doc, written: true, issues: full.issues };
}
