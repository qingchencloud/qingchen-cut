#!/usr/bin/env bun
/**
 * 下载 whisper.cpp 预编译二进制与模型到 vendor/（gitignore，不入库）。
 * 用法: bun script/install-whisper.ts [--model base|small|medium|large-v3-turbo] [--force]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

const WHISPER_TAG = "v1.8.6";
const BIN_ASSET = "whisper-bin-x64.zip";
const root = join(import.meta.dir, "..");
const whisperDir = join(root, "vendor", "whisper");
const modelsDir = join(root, "vendor", "models");

const force = process.argv.includes("--force");
const modelIdx = process.argv.indexOf("--model");
const model = modelIdx >= 0 ? process.argv[modelIdx + 1]! : "base";

function sh(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: "inherit", windowsHide: true });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} 失败 (exit ${r.status})`);
}

const exe = join(whisperDir, "whisper-cli.exe");
if (!existsSync(exe) || force) {
  mkdirSync(whisperDir, { recursive: true });
  const zip = join(whisperDir, BIN_ASSET);
  console.error(`下载 whisper.cpp ${WHISPER_TAG} (${BIN_ASSET}) ...`);
  sh("gh", ["release", "download", WHISPER_TAG, "-R", "ggml-org/whisper.cpp", "-p", BIN_ASSET, "-D", whisperDir, "--clobber"]);
  sh("tar", ["-xf", zip, "-C", whisperDir]);
  rmSync(zip);
  // 压缩包内层是 Release/ 目录，拍平
  const releaseDir = join(whisperDir, "Release");
  if (existsSync(releaseDir)) {
    for (const f of require("node:fs").readdirSync(releaseDir)) {
      renameSync(join(releaseDir, f), join(whisperDir, f));
    }
    rmSync(releaseDir, { recursive: true, force: true });
  }
}

const modelFile = join(modelsDir, `ggml-${model}.bin`);
if (!existsSync(modelFile) || force) {
  mkdirSync(modelsDir, { recursive: true });
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;
  console.error(`下载模型 ggml-${model}.bin ...`);
  sh("curl.exe", ["-L", "--fail", "-o", modelFile, url]);
}

console.log(JSON.stringify({ ok: true, whisperCli: exe, model: modelFile }, null, 2));
