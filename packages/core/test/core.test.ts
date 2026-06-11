import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { makeFixtures } from "../../../script/make-fixtures";
import { probeMedia, resolveTool, runDoctor, validateJobFile } from "../src/index";

const fixturesDir = join(import.meta.dir, "..", "..", "..", "fixtures");

const hasFFmpeg = resolveTool("ffmpeg") !== null && resolveTool("ffprobe") !== null;

beforeAll(async () => {
  if (hasFFmpeg) await makeFixtures();
});

describe.if(hasFFmpeg)("doctor", () => {
  test(
    "本机环境诊断通过",
    async () => {
      const report = await runDoctor();
      expect(report.checks.find((c) => c.id === "ffmpeg")?.ok).toBe(true);
      expect(report.checks.find((c) => c.id === "filter:subtitles")?.ok).toBe(true);
      expect(report.checks.find((c) => c.id === "filter:drawtext")?.ok).toBe(true);
    },
    30_000,
  );
});

describe.if(hasFFmpeg)("probe（中文+空格路径）", () => {
  test("读取中文文件名素材元数据", async () => {
    const result = await probeMedia(join(fixturesDir, "media", "测试 红色.mp4"));
    expect(result.issues).toHaveLength(0);
    expect(result.info!.durationSec).toBeGreaterThan(4.5);
    expect(result.info!.video!.width).toBe(640);
    expect(result.info!.video!.fps).toBe(30);
    expect(result.info!.audio.length).toBeGreaterThan(0);
  });

  test("不存在的文件 → FS_MEDIA_NOT_FOUND", async () => {
    const result = await probeMedia("D:/不存在/nope.mp4");
    expect(result.issues[0]!.code).toBe("FS_MEDIA_NOT_FOUND");
  });
});

describe.if(hasFFmpeg)("validate 完整链路", () => {
  test("valid-full：schema+语义+文件+深度校验全通过", async () => {
    const result = await validateJobFile(join(fixturesDir, "jobs", "valid-full.json"));
    expect(result.issues.filter((i) => i.level === "error")).toHaveLength(0);
    expect(result.ok).toBe(true);
    expect(result.totalDurationSec).toBeCloseTo(4.5, 5);
    expect(Object.keys(result.assetInfo!)).toEqual(["red", "blue", "bgm"]);
  });

  test("out 超出素材时长 → DSL_OUT_EXCEEDS_DURATION", async () => {
    const result = await validateJobFile(join(fixturesDir, "jobs", "valid-minimal.json"));
    expect(result.ok).toBe(true);
    // 把同一个 job 的 out 改大：用临时文件验证深度校验
    const { writeFileSync, readFileSync, rmSync } = await import("node:fs");
    const src = readFileSync(join(fixturesDir, "jobs", "valid-minimal.json"), "utf8");
    const tmp = join(fixturesDir, "jobs", "__tmp-out-too-big.json");
    writeFileSync(tmp, src.replace('"out": 3', '"out": 999'));
    try {
      const bad = await validateJobFile(tmp);
      expect(bad.ok).toBe(false);
      expect(bad.issues.some((i) => i.code === "DSL_OUT_EXCEEDS_DURATION")).toBe(true);
    } finally {
      rmSync(tmp);
    }
  });

  test("素材文件不存在 → FS_ASSET_NOT_FOUND", async () => {
    const { writeFileSync, readFileSync, rmSync } = await import("node:fs");
    const src = readFileSync(join(fixturesDir, "jobs", "valid-minimal.json"), "utf8");
    const tmp = join(fixturesDir, "jobs", "__tmp-missing-asset.json");
    writeFileSync(tmp, src.replace("测试 红色.mp4", "没有这个文件.mp4"));
    try {
      const bad = await validateJobFile(tmp);
      expect(bad.ok).toBe(false);
      expect(bad.issues.some((i) => i.code === "FS_ASSET_NOT_FOUND")).toBe(true);
    } finally {
      rmSync(tmp);
    }
  });
});
