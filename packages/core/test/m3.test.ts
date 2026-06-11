import { beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { makeFixtures } from "../../../script/make-fixtures";
import { analyzeMedia, contactSheet, patchJobFile, resolveTool, validateJobFile } from "../src/index";

const fixturesDir = join(import.meta.dir, "..", "..", "..", "fixtures");
const hasFFmpeg = resolveTool("ffmpeg") !== null && resolveTool("ffprobe") !== null;

beforeAll(async () => {
  if (hasFFmpeg) await makeFixtures();
});

describe.if(hasFFmpeg)("analyze（场景/静音/响度）", () => {
  test(
    "scene-cut.mp4：检出 t≈2s 场景切换与 1.5~2.5s 静音段",
    async () => {
      const result = await analyzeMedia(join(fixturesDir, "media", "scene-cut.mp4"));
      expect(result.ok).toBe(true);
      expect(result.scenes!.length).toBeGreaterThanOrEqual(1);
      expect(Math.abs(result.scenes![0]!.atSec - 2)).toBeLessThan(0.2);
      expect(result.silences!.length).toBe(1);
      expect(Math.abs(result.silences![0]!.startSec - 1.5)).toBeLessThan(0.3);
      expect(Math.abs(result.silences![0]!.endSec - 2.5)).toBeLessThan(0.3);
      expect(result.loudness).not.toBeNull();
      expect(result.loudness!.inputI).toBeLessThan(0); // LUFS 必为负
    },
    120_000,
  );

  test(
    "纯色无切换素材：scenes 为空",
    async () => {
      const result = await analyzeMedia(join(fixturesDir, "media", "测试 红色.mp4"));
      expect(result.ok).toBe(true);
      expect(result.scenes).toHaveLength(0);
    },
    120_000,
  );
});

describe.if(hasFFmpeg)("contact-sheet", () => {
  test(
    "job 模式：成片九宫格",
    async () => {
      const outPng = join(fixturesDir, "out", "sheet-job.png");
      const result = await contactSheet(join(fixturesDir, "jobs", "valid-full.json"), outPng);
      expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
      expect(result.ok).toBe(true);
      expect(existsSync(outPng)).toBe(true);
      expect(result.frameTimesSec).toHaveLength(9);
      expect(result.frameTimesSec![8]).toBeCloseTo(4.0, 1);
    },
    300_000,
  );

  test(
    "媒体模式：素材九宫格",
    async () => {
      const outPng = join(fixturesDir, "out", "sheet-media.png");
      const result = await contactSheet(join(fixturesDir, "media", "scene-cut.mp4"), outPng, { cols: 2, rows: 2 });
      expect(result.ok).toBe(true);
      expect(existsSync(outPng)).toBe(true);
      expect(result.frameTimesSec).toHaveLength(4);
    },
    120_000,
  );
});

describe.if(hasFFmpeg)("patch 文件链路", () => {
  const tmpJob = join(fixturesDir, "jobs", "__tmp-patch.json");

  test("合法 patch 落盘并通过完整校验", async () => {
    copyFileSync(join(fixturesDir, "jobs", "valid-minimal.json"), tmpJob);
    try {
      const result = await patchJobFile(tmpJob, [
        { op: "replace", path: "/tracks/0/clips/0/out", value: 2 },
        { op: "add", path: "/project/fps", value: 25 },
      ]);
      expect(result.ok).toBe(true);
      expect(result.written).toBe(true);
      const validated = await validateJobFile(tmpJob);
      expect(validated.job!.project.fps).toBe(25);
      expect(validated.totalDurationSec).toBeCloseTo(2, 5);
    } finally {
      rmSync(tmpJob, { force: true });
    }
  }, 60_000);

  test("patch 后语义非法 → 不落盘，返回 issues", async () => {
    copyFileSync(join(fixturesDir, "jobs", "valid-minimal.json"), tmpJob);
    try {
      const result = await patchJobFile(tmpJob, [{ op: "replace", path: "/tracks/0/clips/0/out", value: 0 }]);
      expect(result.ok).toBe(false);
      expect(result.written).toBeUndefined();
      expect(result.issues.some((i) => i.code === "DSL_TIME_RANGE")).toBe(true);
      // 原文件未被破坏
      const validated = await validateJobFile(tmpJob);
      expect(validated.ok).toBe(true);
    } finally {
      rmSync(tmpJob, { force: true });
    }
  }, 60_000);

  test("dry-run 不写文件", async () => {
    copyFileSync(join(fixturesDir, "jobs", "valid-minimal.json"), tmpJob);
    try {
      const result = await patchJobFile(tmpJob, [{ op: "replace", path: "/project/name", value: "renamed" }], {
        dryRun: true,
      });
      expect(result.ok).toBe(true);
      expect(result.written).toBe(false);
      const validated = await validateJobFile(tmpJob, { skipProbe: true });
      expect(validated.job!.project.name).toBe("minimal");
    } finally {
      rmSync(tmpJob, { force: true });
    }
  }, 60_000);
});
