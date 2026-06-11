import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { makeFixtures } from "../../../script/make-fixtures";
import {
  resolveTool,
  resolveWhisper,
  resolveWhisperModel,
  segmentsToSrt,
  transcribeMedia,
} from "../src/index";

const fixturesDir = join(import.meta.dir, "..", "..", "..", "fixtures");
const speechWav = join(fixturesDir, "media", "语音 测试.wav");

const hasFFmpeg = resolveTool("ffmpeg") !== null && resolveTool("ffprobe") !== null;
const hasWhisper = resolveWhisper() !== null && resolveWhisperModel() !== null;

beforeAll(async () => {
  if (hasFFmpeg) await makeFixtures();
});

describe("SRT 生成（纯函数）", () => {
  test("时间格式与编号正确", () => {
    const srt = segmentsToSrt([
      { startSec: 0.5, endSec: 2, text: "第一句" },
      { startSec: 62.25, endSec: 65, text: "第二句" },
    ]);
    expect(srt).toContain("1\n00:00:00,500 --> 00:00:02,000\n第一句");
    expect(srt).toContain("2\n00:01:02,250 --> 00:01:05,000\n第二句");
  });
});

describe.if(hasFFmpeg && hasWhisper)("whisper.cpp 转写（中文+空格路径）", () => {
  test(
    "TTS 语音 → 带时间戳 segments + SRT",
    async () => {
      if (!existsSync(speechWav)) return; // 本机无中文 TTS 音色时跳过
      const srtOut = join(fixturesDir, "out", "speech.srt");
      rmSync(srtOut, { force: true });
      const result = await transcribeMedia(speechWav, { language: "zh", outSrt: srtOut });
      expect(result.issues).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.segments!.length).toBeGreaterThanOrEqual(1);
      expect(result.segments![0]!.endSec).toBeGreaterThan(result.segments![0]!.startSec);
      // base 模型允许错别字，只验证关键词（简/繁均接受）
      expect(result.text!).toMatch(/天[气氣]/);
      expect(existsSync(srtOut)).toBe(true);
      expect(readFileSync(srtOut, "utf8")).toContain("-->");
    },
    600_000,
  );

  test("无音轨素材 → DSL_ASSET_NO_AUDIO", async () => {
    // 用一个纯视频(无音轨)临时素材验证
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { run } = await import("../src/ffmpeg");
    const ffmpeg = resolveTool("ffmpeg")!;
    const dir = mkdtempSync(join(tmpdir(), "qc-novideo-"));
    const silent = join(dir, "no-audio.mp4");
    await run(ffmpeg.path, ["-y", "-f", "lavfi", "-i", "color=c=green:s=160x90:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", silent], { timeoutMs: 60_000 });
    try {
      const result = await transcribeMedia(silent);
      expect(result.ok).toBe(false);
      expect(result.issues[0]!.code).toBe("DSL_ASSET_NO_AUDIO");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
