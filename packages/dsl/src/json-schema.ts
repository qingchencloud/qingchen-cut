import { z } from "zod";
import { jobSchema } from "./schema";

/** 导出 JSON Schema，供任意 AI/工具直接读取作为 DSL 文档 */
export function getJobJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(jobSchema, { target: "draft-7" }) as Record<string, unknown>;
}
