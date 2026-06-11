import { issue, type QcIssue } from "./issues";

/**
 * RFC 6902 JSON Patch 子集：add / remove / replace / test。
 * AI 增量修改 DSL 用，避免整份重写。
 */
export interface PatchOp {
  op: "add" | "remove" | "replace" | "test";
  /** JSON Pointer，如 /tracks/0/clips/1/out */
  path: string;
  value?: unknown;
}

function decodePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`JSON Pointer 必须以 / 开头: "${pointer}"`);
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

interface Located {
  parent: any;
  key: string | number;
  exists: boolean;
}

function locate(doc: any, pointer: string, forAdd: boolean): Located {
  const parts = decodePointer(pointer);
  if (parts.length === 0) throw new Error("不支持对整个文档做该操作");
  let node = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = Array.isArray(node) ? Number(parts[i]) : parts[i]!;
    node = node?.[key as any];
    if (node === undefined || node === null) {
      throw new Error(`路径不存在: /${parts.slice(0, i + 1).join("/")}`);
    }
  }
  const last = parts[parts.length - 1]!;
  if (Array.isArray(node)) {
    if (last === "-") {
      if (!forAdd) throw new Error('"-" 仅可用于 add 追加数组元素');
      return { parent: node, key: node.length, exists: false };
    }
    const idx = Number(last);
    if (!Number.isInteger(idx) || idx < 0 || idx > node.length - (forAdd ? 0 : 1)) {
      throw new Error(`数组下标越界: ${pointer}（长度 ${node.length}）`);
    }
    return { parent: node, key: idx, exists: idx < node.length };
  }
  if (typeof node !== "object") throw new Error(`路径中段不是对象/数组: ${pointer}`);
  return { parent: node, key: last, exists: Object.prototype.hasOwnProperty.call(node, last) };
}

export interface PatchResult {
  doc?: unknown;
  issues: QcIssue[];
}

/** 在普通 JSON 对象上应用 patch（深拷贝，不改原对象）。任何一个 op 失败则整体失败。 */
export function applyPatch(input: unknown, ops: PatchOp[]): PatchResult {
  const doc = structuredClone(input) as any;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    try {
      switch (op.op) {
        case "add": {
          const { parent, key } = locate(doc, op.path, true);
          if (Array.isArray(parent)) parent.splice(key as number, 0, op.value);
          else parent[key] = op.value;
          break;
        }
        case "replace": {
          const { parent, key, exists } = locate(doc, op.path, false);
          if (!exists) throw new Error(`replace 目标不存在: ${op.path}（新增字段请用 add）`);
          parent[key as any] = op.value;
          break;
        }
        case "remove": {
          const { parent, key, exists } = locate(doc, op.path, false);
          if (!exists) throw new Error(`remove 目标不存在: ${op.path}`);
          if (Array.isArray(parent)) parent.splice(key as number, 1);
          else delete parent[key];
          break;
        }
        case "test": {
          const { parent, key, exists } = locate(doc, op.path, false);
          const actual = exists ? parent[key as any] : undefined;
          if (JSON.stringify(actual) !== JSON.stringify(op.value)) {
            throw new Error(`test 不匹配: ${op.path} 当前值 ${JSON.stringify(actual)}`);
          }
          break;
        }
        default:
          throw new Error(`不支持的 op: ${(op as any).op}（支持 add/remove/replace/test）`);
      }
    } catch (e) {
      return {
        issues: [
          issue("PATCH_OP_FAILED", "validate", `第 ${i + 1} 个操作失败: ${(e as Error).message}`, {
            path: op.path,
            suggestion: "检查 JSON Pointer 路径与当前 DSL 结构是否一致；可先 qc validate 查看当前结构",
          }),
        ],
      };
    }
  }
  return { doc, issues: [] };
}
