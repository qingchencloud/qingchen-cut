import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureBundledRuntime,
  createPackagedWebEnv,
  resolveDesktopRuntimePaths,
  resolvePackagedWebRuntime,
} from "../src/desktop-launcher";

const oldFfmpeg = process.env["QC_FFMPEG_PATH"];
const oldWhisper = process.env["QC_WHISPER_PATH"];
const oldModel = process.env["QC_WHISPER_MODEL"];

afterEach(() => {
  if (oldFfmpeg === undefined) delete process.env["QC_FFMPEG_PATH"];
  else process.env["QC_FFMPEG_PATH"] = oldFfmpeg;
  if (oldWhisper === undefined) delete process.env["QC_WHISPER_PATH"];
  else process.env["QC_WHISPER_PATH"] = oldWhisper;
  if (oldModel === undefined) delete process.env["QC_WHISPER_MODEL"];
  else process.env["QC_WHISPER_MODEL"] = oldModel;
});

describe("desktop launcher runtime", () => {
  test("resolves paths next to the packaged executable", () => {
    const paths = resolveDesktopRuntimePaths("D:\\Apps\\QingchenCut\\QingchenCutStudio.exe", "C:\\Users\\me");

    expect(paths.appDir).toBe("D:\\Apps\\QingchenCut");
    expect(paths.binDir).toBe("D:\\Apps\\QingchenCut\\bin");
    expect(paths.defaultOutDir).toBe("C:\\Users\\me\\Videos\\Qingchen Cut");
  });

  test("configures bundled FFmpeg and whisper paths when files exist", () => {
    const root = join(tmpdir(), `qc-desktop-${Date.now()}`);
    const binDir = join(root, "bin");
    const modelDir = join(root, "models");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(binDir, "ffmpeg.exe"), "");
    writeFileSync(join(binDir, "ffprobe.exe"), "");
    writeFileSync(join(binDir, "whisper-cli.exe"), "");
    writeFileSync(join(modelDir, "ggml-base.bin"), "");

    const configured = configureBundledRuntime({
      appDir: root,
      binDir,
      modelDir,
      defaultOutDir: join(root, "out"),
    });

    expect(configured.ffmpeg).toBe(binDir);
    expect(configured.whisper).toBe(join(binDir, "whisper-cli.exe"));
    expect(configured.whisperModel).toBe(join(modelDir, "ggml-base.bin"));
    expect(process.env["QC_FFMPEG_PATH"]).toBe(binDir);
    expect(process.env["QC_WHISPER_PATH"]).toBe(join(binDir, "whisper-cli.exe"));
    expect(process.env["QC_WHISPER_MODEL"]).toBe(join(modelDir, "ggml-base.bin"));

    rmSync(root, { recursive: true, force: true });
  });

  test("resolves packaged original web runtime next to the executable", () => {
    const paths = resolveDesktopRuntimePaths("D:\\Apps\\QingchenCut\\QingchenCut.exe", "C:\\Users\\me");
    const web = resolvePackagedWebRuntime(paths);

    expect(web.bunExe).toBe("D:\\Apps\\QingchenCut\\runtime\\bun.exe");
    expect(web.serverJs).toBe("D:\\Apps\\QingchenCut\\web\\server.js");
    expect(web.serverDir).toBe("D:\\Apps\\QingchenCut\\web");
    expect(web.url).toBe("http://127.0.0.1:4477/projects");
  });

  test("prefers the preserved Next standalone web server path when present", () => {
    const root = join(tmpdir(), `qc-web-runtime-${Date.now()}`);
    const serverDir = join(root, "web", "apps", "web");
    mkdirSync(serverDir, { recursive: true });
    writeFileSync(join(serverDir, "server.js"), "");

    const web = resolvePackagedWebRuntime({
      appDir: root,
      binDir: join(root, "bin"),
      modelDir: join(root, "models"),
      defaultOutDir: join(root, "out"),
    });

    expect(web.serverJs).toBe(join(serverDir, "server.js"));
    expect(web.serverDir).toBe(serverDir);

    rmSync(root, { recursive: true, force: true });
  });

  test("creates local-client env for the packaged original web server", () => {
    const paths = resolveDesktopRuntimePaths("D:\\Apps\\QingchenCut\\QingchenCut.exe", "C:\\Users\\me");
    const web = resolvePackagedWebRuntime(paths, { port: 4488 });
    const env = createPackagedWebEnv(paths, web);

    expect(env["QC_LOCAL_CLIENT"]).toBe("1");
    expect(env["NEXT_PUBLIC_QC_CLIENT_MODE"]).toBe("desktop");
    expect(env["NEXT_PUBLIC_SITE_URL"]).toBe("http://127.0.0.1:4488");
    expect(env["PORT"]).toBe("4488");
    expect(env["QC_FFMPEG_PATH"]).toBe("D:\\Apps\\QingchenCut\\bin");
  });
});
