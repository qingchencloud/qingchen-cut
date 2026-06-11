import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { makeFixtures } from "../../../script/make-fixtures";
import {
  createNarratedJobFile,
  narrationSegmentsToSrt,
  parseNarrationScript,
  probeMedia,
  resolveTool,
  synthesizeNarration,
  validateJobFile,
} from "../src/index";

const fixturesDir = join(import.meta.dir, "..", "..", "..", "fixtures");
const hasFFmpeg = resolveTool("ffmpeg") !== null && resolveTool("ffprobe") !== null;

beforeAll(async () => {
  if (hasFFmpeg) await makeFixtures();
});

describe("narration script parsing", () => {
  test("JSON object script keeps title and segment order", () => {
    const parsed = parseNarrationScript(
      JSON.stringify({
        title: "晴辰剪辑配音验收",
        segments: ["第一段配音。", { text: "第二段配音。" }],
      }),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.title).toBe("晴辰剪辑配音验收");
    expect(parsed.segments?.map((s) => s.text)).toEqual(["第一段配音。", "第二段配音。"]);
  });

  test("plain text script splits non-empty lines into segments", () => {
    const parsed = parseNarrationScript("第一段配音。\n\n第二段配音。");

    expect(parsed.ok).toBe(true);
    expect(parsed.segments?.map((s) => s.text)).toEqual(["第一段配音。", "第二段配音。"]);
  });

  test("generated SRT wraps long Chinese narration without leading punctuation", () => {
    const srt = narrationSegmentsToSrt([
      {
        text: "最后由同一套 MCP 工具完成校验、抽帧、自检、渲染和速览。",
        startSec: 0,
        endSec: 5,
      },
    ]);
    const cueLines = srt
      .split(/\r?\n/)
      .filter((line) => line && !/^\d+$/.test(line) && !line.includes("-->"));

    expect(cueLines.length).toBeGreaterThan(1);
    expect(cueLines.every((line) => !/^[、，。！？；：,.!?;:]/.test(line))).toBe(true);
  });
});

describe.if(hasFFmpeg && process.platform === "win32")("SAPI narration TTS", () => {
  test(
    "synthesizes per-segment WAV files, SRT timings, and a valid narrated DSL",
    async () => {
      const outDir = join(fixturesDir, "out", "tts-sync");
      rmSync(outDir, { recursive: true, force: true });

      const narration = await synthesizeNarration({
        segments: [{ text: "晴辰剪辑现在可以自动生成配音。" }, { text: "画面、字幕和声音按真实时长同步。" }],
        outDir,
        baseName: "voice-sync",
        rate: 0,
        volume: 90,
      });

      expect(narration.ok).toBe(true);
      expect(narration.segments).toHaveLength(2);
      expect(existsSync(narration.srtPath!)).toBe(true);
      expect(narration.totalDurationSec).toBeGreaterThan(1);
      expect(narration.segments![0]!.startSec).toBe(0);
      expect(narration.segments![1]!.startSec).toBeCloseTo(narration.segments![0]!.endSec, 3);
      for (const seg of narration.segments!) {
        expect(existsSync(seg.audioPath)).toBe(true);
        const probed = await probeMedia(seg.audioPath);
        expect(probed.issues).toEqual([]);
        expect(probed.info?.audio.length).toBeGreaterThan(0);
      }

      const jobPath = join(outDir, "voice-sync-job.json");
      const outputPath = join(outDir, "voice-sync.mp4");
      const job = await createNarratedJobFile({
        narration,
        videoPath: join(fixturesDir, "media", "测试 红色.mp4"),
        bgmPath: join(fixturesDir, "media", "bgm.mp3"),
        jobPath,
        outputPath,
        title: "配音同步验收",
        project: {
          name: "tts-sync",
          canvas: { width: 1080, height: 1920 },
          fps: 30,
          background: "#101010",
        },
      });

      expect(job.ok).toBe(true);
      expect(existsSync(jobPath)).toBe(true);
      const validation = await validateJobFile(jobPath);
      expect(validation.ok).toBe(true);
      expect(validation.totalDurationSec).toBeCloseTo(narration.totalDurationSec!, 2);
      const videoTrack = validation.job!.tracks.find((t) => t.type === "video")!;
      expect(videoTrack.type).toBe("video");
      expect(videoTrack.clips).toHaveLength(2);
    },
    120_000,
  );
});
