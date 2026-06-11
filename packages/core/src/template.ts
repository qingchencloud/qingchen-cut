import { hasErrors, issue, parseJob, type QcIssue } from "@qingchen/cut-dsl";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * 模板实例化：DSL 模板中的 "${变量名}" 占位符 + 变量表 → 具体 job。
 * 整值占位符（"${count}"）保留变量原始类型（数字/对象），
 * 字符串内嵌占位符（"标题：${title}"）做字符串拼接。
 */

export interface TemplateResult {
  ok: boolean;
  job?: unknown;
  written?: string;
  /** 模板中出现的全部变量名 */
  variables?: string[];
  issues: QcIssue[];
}

const PLACEHOLDER = /\$\{([\w.-]+)\}/g;

function substitute(node: unknown, vars: Record<string, unknown>, used: Set<string>, missing: Set<string>): unknown {
  if (typeof node === "string") {
    const whole = /^\$\{([\w.-]+)\}$/.exec(node);
    if (whole) {
      const name = whole[1]!;
      used.add(name);
      if (!(name in vars)) {
        missing.add(name);
        return node;
      }
      return vars[name];
    }
    return node.replace(PLACEHOLDER, (_, name: string) => {
      used.add(name);
      if (!(name in vars)) {
        missing.add(name);
        return `\${${name}}`;
      }
      return String(vars[name]);
    });
  }
  if (Array.isArray(node)) return node.map((n) => substitute(n, vars, used, missing));
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, substitute(v, vars, used, missing)]));
  }
  return node;
}

/** 实例化模板并做 schema+语义校验；通过且传了 outPath 才落盘 */
export function renderTemplate(
  templatePath: string,
  vars: Record<string, unknown>,
  outPath?: string,
): TemplateResult {
  if (!existsSync(templatePath)) {
    return { ok: false, issues: [issue("FS_TEMPLATE_NOT_FOUND", "validate", `模板文件不存在: ${templatePath}`)] };
  }
  let template: unknown;
  try {
    template = JSON.parse(readFileSync(templatePath, "utf8"));
  } catch (e) {
    return { ok: false, issues: [issue("DSL_JSON_SYNTAX", "validate", `模板 JSON 语法错误: ${(e as Error).message}`)] };
  }

  const used = new Set<string>();
  const missing = new Set<string>();
  const job = substitute(template, vars, used, missing);

  if (missing.size > 0) {
    return {
      ok: false,
      variables: [...used],
      issues: [
        issue("TEMPLATE_MISSING_VARS", "validate", `缺少变量: ${[...missing].join(", ")}`, {
          suggestion: `在 vars 中补齐这些变量；模板共引用变量: ${[...used].join(", ")}`,
        }),
      ],
    };
  }

  const parsed = parseJob(job);
  if (!parsed.job || hasErrors(parsed.issues)) {
    return { ok: false, job, variables: [...used], issues: parsed.issues };
  }

  let written: string | undefined;
  if (outPath) {
    written = resolve(outPath);
    mkdirSync(dirname(written), { recursive: true });
    writeFileSync(written, JSON.stringify(job, null, 2) + "\n", "utf8");
  }
  return { ok: true, job, written, variables: [...used], issues: parsed.issues };
}
