import { jobSchema, type Job } from "./schema";
import { issue, type QcIssue } from "./issues";
import { validateSemantics } from "./semantic";

export interface ParseResult {
  job?: Job;
  issues: QcIssue[];
}

/** schema 校验 + 语义校验。输入为已 JSON.parse 的对象。 */
export function parseJob(input: unknown): ParseResult {
  const parsed = jobSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((zi) =>
      issue("DSL_SCHEMA", "validate", zi.message, {
        path: "/" + zi.path.map(String).join("/"),
        suggestion: "对照 qc schema 输出的 JSON Schema 修正该字段",
      }),
    );
    return { issues };
  }
  const job = parsed.data;
  return { job, issues: validateSemantics(job) };
}

/** 解析 JSON 文本（处理 JSON 语法错误） */
export function parseJobText(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return {
      issues: [
        issue("DSL_JSON_SYNTAX", "validate", `JSON 语法错误: ${(e as Error).message}`, {
          suggestion: "检查 JSON 语法（逗号、引号、括号配对）",
        }),
      ],
    };
  }
  return parseJob(data);
}
