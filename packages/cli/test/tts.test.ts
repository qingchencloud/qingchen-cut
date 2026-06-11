import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { makeFixtures } from "../../../script/make-fixtures";
import { resolveTool, validateJobFile } from "@qingchen/cut-core";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const fixturesDir = join(repoRoot, "fixtures");
const cliPath = join(repoRoot, "packages", "cli", "src", "qc.ts");
const hasFFmpeg = resolveTool("ffmpeg") !== null && resolveTool("ffprobe") !== null;

function runQc(args: string[], timeout = 120_000): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeAll(async () => {
  if (hasFFmpeg) await makeFixtures();
});

describe.if(hasFFmpeg && process.platform === "win32")("qc TTS commands", () => {
  test("tts synthesizes a WAV file and reports duration", () => {
    const outWav = join(fixturesDir, "out", "cli-tts.wav");
    rmSync(outWav, { force: true });

    const result = runQc(["tts", "--text", "晴辰剪辑自动配音测试。", "--out", outWav]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.durationSec).toBeGreaterThan(0);
    expect(existsSync(outWav)).toBe(true);
  }, 120_000);

  test("narrate synthesizes voice segments and writes a validated DSL job", async () => {
    const outDir = join(fixturesDir, "out", "cli-narrate");
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    const scriptPath = join(outDir, "script.txt");
    const jobPath = join(outDir, "job.json");
    const outputPath = join(outDir, "video.mp4");
    writeFileSync(scriptPath, "第一段配音。\n第二段配音和画面同步。", "utf8");

    const result = runQc(
      [
        "narrate",
        "--script",
        scriptPath,
        "--video",
        join(fixturesDir, "media", "测试 红色.mp4"),
        "--bgm",
        join(fixturesDir, "media", "bgm.mp3"),
        "--out-dir",
        outDir,
        "--out-job",
        jobPath,
        "--out",
        outputPath,
        "--title",
        "CLI 配音同步",
      ],
      180_000,
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.narration.totalDurationSec).toBeGreaterThan(0);
    expect(existsSync(jobPath)).toBe(true);
    const validation = await validateJobFile(jobPath);
    expect(validation.ok).toBe(true);
  }, 180_000);
});
