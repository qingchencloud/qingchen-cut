import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createStudioFetch, type StudioServices } from "../src/studio";

interface StudioJobResponse {
  ok: boolean;
  error?: string;
  jobPath: string;
  outputPath: string;
  sheetPath: string;
  sheetUrl: string;
  videoUrl: string;
}

function makeServices(record: string[]): StudioServices {
  return {
    runDoctor: async () => ({ ok: true, platform: "test", checks: [] }),
    analyzeMedia: async (mediaPath) => {
      record.push(`analyze:${mediaPath}`);
      return { ok: true, path: mediaPath, durationSec: 3, scenes: [], silences: [], loudness: null, issues: [] };
    },
    parseNarrationScript: (text) => {
      record.push(`parse:${text}`);
      return { ok: true, title: "测试标题", segments: [{ text }], issues: [] };
    },
    synthesizeNarration: async ({ outDir, segments }) => {
      record.push(`tts:${segments.length}:${outDir}`);
      mkdirSync(outDir, { recursive: true });
      return { ok: true, segments: [], totalDurationSec: 1.2, srtPath: join(outDir, "voice.srt"), issues: [] };
    },
    createNarratedJobFile: async ({ jobPath, outputPath }) => {
      record.push(`job:${jobPath}:${outputPath}`);
      mkdirSync(dirname(jobPath), { recursive: true });
      writeFileSync(jobPath, JSON.stringify({ ok: true }), "utf8");
      return { ok: true, jobPath, outputPath, issues: [] };
    },
    validateJobFile: async (jobPath) => {
      record.push(`validate:${jobPath}`);
      return { ok: true, jobPath, issues: [] };
    },
    renderJob: async (jobPath) => {
      record.push(`render:${jobPath}`);
      const output = join(dirname(jobPath), "studio.mp4");
      writeFileSync(output, "fake video", "utf8");
      return { ok: true, output, issues: [] };
    },
    contactSheet: async (target, outPng) => {
      record.push(`sheet:${target}:${outPng}`);
      writeFileSync(outPng, "fake png", "utf8");
      return { ok: true, output: outPng, frameTimesSec: [0], issues: [] };
    },
  };
}

describe("qc studio local client", () => {
  test("serves a local Studio shell with the expected workflow controls", async () => {
    const record: string[] = [];
    const fetch = createStudioFetch({
      repoRoot: mkdtempSync(join(tmpdir(), "qc-studio-test-")),
      defaultOutDir: mkdtempSync(join(tmpdir(), "qc-studio-out-")),
      services: makeServices(record),
    });

    const response = await fetch(new Request("http://studio.local/"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("晴辰剪辑 Studio");
    expect(html).toContain("视频路径");
    expect(html).toContain("文案 / 配音稿");
    expect(html).toContain("生成成片");
  });

  test("runs the narrated video workflow and exposes generated preview files", async () => {
    const temp = mkdtempSync(join(tmpdir(), "qc-studio-test-"));
    const outDir = join(temp, "runs");
    const record: string[] = [];
    const fetch = createStudioFetch({
      repoRoot: temp,
      defaultOutDir: outDir,
      services: makeServices(record),
    });

    const response = await fetch(
      new Request("http://studio.local/api/jobs/narrated-video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          videoPath: "D:/media/demo.mp4",
          bgmPath: "D:/media/bgm.mp3",
          script: "第一段文案。",
          title: "测试标题",
        }),
      }),
    );
    const result = (await response.json()) as StudioJobResponse;

    expect(response.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.outputPath).toEndWith("studio.mp4");
    expect(result.sheetPath).toEndWith("contact-sheet.png");
    expect(result.sheetUrl).toStartWith("/api/file?");
    expect(result.videoUrl).toStartWith("/api/file?");
    expect(existsSync(result.jobPath)).toBe(true);
    expect(record.some((entry) => entry.startsWith("analyze:D:/media/demo.mp4"))).toBe(true);
    expect(record.some((entry) => entry.startsWith("tts:1:"))).toBe(true);

    const preview = await fetch(new Request(`http://studio.local${result.sheetUrl}`));
    expect(preview.status).toBe(200);
    expect(await preview.text()).toBe("fake png");

    rmSync(temp, { recursive: true, force: true });
  });

  test("rejects generation requests without a video path or script", async () => {
    const record: string[] = [];
    const fetch = createStudioFetch({
      repoRoot: mkdtempSync(join(tmpdir(), "qc-studio-test-")),
      defaultOutDir: mkdtempSync(join(tmpdir(), "qc-studio-out-")),
      services: makeServices(record),
    });

    const response = await fetch(
      new Request("http://studio.local/api/jobs/narrated-video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ script: "" }),
      }),
    );
    const result = (await response.json()) as StudioJobResponse;

    expect(response.status).toBe(400);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("videoPath");
  });
});
