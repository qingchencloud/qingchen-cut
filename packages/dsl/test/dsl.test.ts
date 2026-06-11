import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getJobJsonSchema,
  hasErrors,
  parseJobText,
  videoTrackDuration,
  type VideoTrack,
} from "../src/index";

const jobsDir = join(import.meta.dir, "..", "..", "..", "fixtures", "jobs");
const readJob = (name: string) => readFileSync(join(jobsDir, name), "utf8");

describe("schema 解析", () => {
  test("valid-minimal 通过且默认值生效", () => {
    const { job, issues } = parseJobText(readJob("valid-minimal.json"));
    expect(hasErrors(issues)).toBe(false);
    expect(job).toBeDefined();
    expect(job!.project.fps).toBe(30);
    expect(job!.export.video.crf).toBe(18);
    const v = job!.tracks[0]!;
    expect(v.type).toBe("video");
    if (v.type === "video") expect(v.clips[0]!.fit).toBe("contain");
  });

  test("文字 clip 缺省 style 时填充完整默认值（zod v4 prefault 回归）", () => {
    const { job, issues } = parseJobText(
      JSON.stringify({
        version: 1,
        project: { name: "t", canvas: { width: 640, height: 360 } },
        assets: [{ id: "a", path: "x.mp4" }],
        tracks: [
          { id: "v1", type: "video", clips: [{ assetId: "a", in: 0, out: 1 }] },
          { id: "t1", type: "text", clips: [{ text: "hi", start: 0, duration: 1 }] },
        ],
        export: { output: "o.mp4" },
      }),
    );
    expect(hasErrors(issues)).toBe(false);
    const t = job!.tracks[1]!;
    if (t.type !== "text") throw new Error("expected text track");
    expect(t.clips[0]!.style.fontFamily).toBe("Microsoft YaHei");
    expect(t.clips[0]!.style.fontSize).toBe(64);
    expect(t.clips[0]!.style.position.anchor).toBe("center");
  });

  test("valid-full 通过，含转场/文字/字幕/音频轨", () => {
    const { job, issues } = parseJobText(readJob("valid-full.json"));
    expect(hasErrors(issues)).toBe(false);
    expect(job!.tracks).toHaveLength(4);
  });

  test("invalid-schema 返回 DSL_SCHEMA 错误并带路径", () => {
    const { issues } = parseJobText(readJob("invalid-schema.json"));
    expect(hasErrors(issues)).toBe(true);
    expect(issues.every((i) => i.code === "DSL_SCHEMA")).toBe(true);
    expect(issues.some((i) => i.path?.startsWith("/project/canvas"))).toBe(true);
  });

  test("JSON 语法错误返回 DSL_JSON_SYNTAX", () => {
    const { issues } = parseJobText("{ not json");
    expect(issues[0]!.code).toBe("DSL_JSON_SYNTAX");
  });
});

describe("语义校验", () => {
  test("引用不存在的素材 → DSL_UNKNOWN_ASSET_REF，suggestion 列出可用 id", () => {
    const { issues } = parseJobText(readJob("invalid-bad-asset-ref.json"));
    const hit = issues.find((i) => i.code === "DSL_UNKNOWN_ASSET_REF");
    expect(hit).toBeDefined();
    expect(hit!.path).toBe("/tracks/0/clips/0/assetId");
    expect(hit!.suggestion).toContain("a");
  });

  test("转场超长 → DSL_TRANSITION_TOO_LONG，给出允许上限", () => {
    const { issues } = parseJobText(readJob("invalid-transition-too-long.json"));
    const hit = issues.find((i) => i.code === "DSL_TRANSITION_TOO_LONG");
    expect(hit).toBeDefined();
    expect(hit!.suggestion).toContain("1.000");
  });

  test("out ≤ in → DSL_TIME_RANGE", () => {
    const text = readJob("valid-minimal.json").replace('"out": 3', '"out": 0');
    const { issues } = parseJobText(text);
    expect(issues.some((i) => i.code === "DSL_TIME_RANGE")).toBe(true);
  });
});

describe("时长计算", () => {
  test("crossfade 吃重叠区：总时长 = Σclip − Σtransition", () => {
    const { job } = parseJobText(readJob("valid-full.json"));
    const v = job!.tracks.find((t) => t.type === "video") as VideoTrack;
    // clip1: (3.5-0.5)/1 = 3s, clip2: 2.5/1.25 = 2s, transition 0.5s → 4.5s
    expect(videoTrackDuration(v)).toBeCloseTo(4.5, 5);
  });
});

describe("JSON Schema 导出", () => {
  test("可导出且包含字段描述", () => {
    const schema = getJobJsonSchema();
    expect(JSON.stringify(schema)).toContain("Editing DSL v1");
  });
});
