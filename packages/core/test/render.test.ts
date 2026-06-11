import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeFixtures } from "../../../script/make-fixtures";
import { extractFrame, planJob, probeMedia, renderJob, resolveTool } from "../src/index";

const fixturesDir = join(import.meta.dir, "..", "..", "..", "fixtures");
const job = (name: string) => join(fixturesDir, "jobs", name);

const hasFFmpeg = resolveTool("ffmpeg") !== null && resolveTool("ffprobe") !== null;

beforeAll(async () => {
  if (hasFFmpeg) await makeFixtures();
});

describe.if(hasFFmpeg)("plan（dry-run）", () => {
  test("valid-full 输出完整渲染计划", async () => {
    const result = await planJob(job("valid-full.json"));
    expect(result.ok).toBe(true);
    expect(result.totalDurationSec).toBeCloseTo(4.5, 5);
    expect(result.inputs).toHaveLength(3); // red, blue, bgm
    expect(result.filtergraph).toContain("xfade=transition=fade:duration=0.5:offset=2.5");
    expect(result.filtergraph).toContain("drawtext=");
    expect(result.filtergraph).toContain("subtitles=");
    expect(result.filtergraph).toContain("amix=");
    expect(result.ffmpegArgs).toContain("-filter_complex_script");
  }, 60_000);
});

describe.if(hasFFmpeg)("render（golden：真渲染 + ffprobe 断言）", () => {
  test(
    "valid-minimal：单 clip 裁切导出",
    async () => {
      const result = await renderJob(job("valid-minimal.json"));
      expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
      expect(result.ok).toBe(true);
      const probed = await probeMedia(result.output!);
      expect(probed.info!.durationSec).toBeCloseTo(3, 0.2);
      expect(probed.info!.video!.width).toBe(640);
      expect(probed.info!.video!.height).toBe(360);
    },
    120_000,
  );

  test(
    "valid-full：转场+变速+文字+字幕+BGM 竖屏导出",
    async () => {
      const progress: number[] = [];
      const result = await renderJob(job("valid-full.json"), {
        onProgress: (p) => progress.push(p.percent),
      });
      expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
      expect(result.ok).toBe(true);
      const probed = await probeMedia(result.output!);
      // crossfade 语义：3 + 2 − 0.5 = 4.5s
      expect(Math.abs(probed.info!.durationSec - 4.5)).toBeLessThan(0.3);
      expect(probed.info!.video!.width).toBe(1080);
      expect(probed.info!.video!.height).toBe(1920);
      expect(probed.info!.video!.fps).toBe(30);
      expect(probed.info!.audio.length).toBeGreaterThan(0);
    },
    300_000,
  );
});

describe.if(hasFFmpeg)("frame（AI 视觉复核入口）", () => {
  test(
    "抽取 0.5s 处单帧 PNG",
    async () => {
      const outPng = join(fixturesDir, "out", "frame-0.5.png");
      const result = await extractFrame(job("valid-full.json"), 0.5, outPng);
      expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
      expect(result.ok).toBe(true);
      expect(existsSync(outPng)).toBe(true);
    },
    120_000,
  );

  test("超出时长 → FRAME_OUT_OF_RANGE 且给出有效范围", async () => {
    const result = await extractFrame(job("valid-full.json"), 99, join(fixturesDir, "out", "nope.png"));
    expect(result.ok).toBe(false);
    const hit = result.issues.find((i) => i.code === "FRAME_OUT_OF_RANGE");
    expect(hit).toBeDefined();
    expect(hit!.suggestion).toContain("4.500");
  }, 60_000);
});
