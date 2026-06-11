import { describe, expect, test } from "bun:test";
import { applyPatch, type PatchOp } from "../src/patch";

const doc = () => ({
  version: 1,
  tracks: [{ id: "v1", clips: [{ in: 0, out: 3 }, { in: 1, out: 2 }] }],
});

describe("JSON Patch 子集", () => {
  test("replace 修改嵌套字段", () => {
    const r = applyPatch(doc(), [{ op: "replace", path: "/tracks/0/clips/1/out", value: 5 }]);
    expect(r.issues).toHaveLength(0);
    expect((r.doc as any).tracks[0].clips[1].out).toBe(5);
  });

  test("add 用 /- 追加数组元素", () => {
    const r = applyPatch(doc(), [{ op: "add", path: "/tracks/0/clips/-", value: { in: 2, out: 4 } }]);
    expect((r.doc as any).tracks[0].clips).toHaveLength(3);
  });

  test("add 按下标插入", () => {
    const r = applyPatch(doc(), [{ op: "add", path: "/tracks/0/clips/0", value: { in: 9, out: 10 } }]);
    expect((r.doc as any).tracks[0].clips[0].in).toBe(9);
    expect((r.doc as any).tracks[0].clips).toHaveLength(3);
  });

  test("remove 删除数组元素", () => {
    const r = applyPatch(doc(), [{ op: "remove", path: "/tracks/0/clips/0" }]);
    expect((r.doc as any).tracks[0].clips).toHaveLength(1);
    expect((r.doc as any).tracks[0].clips[0].in).toBe(1);
  });

  test("test 守卫：匹配通过，不匹配整体失败", () => {
    const ok = applyPatch(doc(), [
      { op: "test", path: "/tracks/0/id", value: "v1" },
      { op: "replace", path: "/version", value: 1 },
    ]);
    expect(ok.issues).toHaveLength(0);
    const bad = applyPatch(doc(), [{ op: "test", path: "/tracks/0/id", value: "v2" }]);
    expect(bad.issues[0]!.code).toBe("PATCH_OP_FAILED");
    expect(bad.doc).toBeUndefined();
  });

  test("路径不存在 → PATCH_OP_FAILED 带原 path", () => {
    const r = applyPatch(doc(), [{ op: "replace", path: "/tracks/9/id", value: "x" }]);
    expect(r.issues[0]!.code).toBe("PATCH_OP_FAILED");
    expect(r.issues[0]!.path).toBe("/tracks/9/id");
  });

  test("原对象不被修改（深拷贝）", () => {
    const original = doc();
    applyPatch(original, [{ op: "replace", path: "/version", value: 99 } satisfies PatchOp]);
    expect(original.version).toBe(1);
  });
});
