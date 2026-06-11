/**
 * 结构化问题/错误格式。所有校验、探测、渲染阶段统一使用，
 * AI 拿到 issue 后应能根据 code + suggestion 自我修复。
 */
export type IssueStage = "validate" | "probe" | "plan" | "render" | "doctor";

export type IssueLevel = "error" | "warning";

export interface QcIssue {
  /** 机器可读错误码，稳定不变，AI 可针对 code 写修复逻辑 */
  code: string;
  stage: IssueStage;
  level: IssueLevel;
  /** 人类可读说明 */
  message: string;
  /** 出问题的 DSL 位置，JSON Pointer 风格，如 /tracks/0/clips/1/out */
  path?: string;
  /** 给 AI 的修复建议 */
  suggestion?: string;
}

export function issue(
  code: string,
  stage: IssueStage,
  message: string,
  opts: { path?: string; suggestion?: string; level?: IssueLevel } = {},
): QcIssue {
  return {
    code,
    stage,
    level: opts.level ?? "error",
    message,
    ...(opts.path ? { path: opts.path } : {}),
    ...(opts.suggestion ? { suggestion: opts.suggestion } : {}),
  };
}

export function hasErrors(issues: QcIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}
