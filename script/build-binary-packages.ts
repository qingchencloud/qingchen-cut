#!/usr/bin/env bun
/**
 * 把本机 FFmpeg/FFprobe/whisper.cpp 二进制打成可发布的 npm 包，输出到 dist-packages/。
 * 包内容: bin/<二进制> + package.json（os/cpu 限定 win32-x64）。
 * 用法: bun script/build-binary-packages.ts [--scope @qingchen]
 *       然后对每个目录 npm publish --access public
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outRoot = join(root, "dist-packages");

const scopeIdx = process.argv.indexOf("--scope");
const scope = scopeIdx >= 0 ? process.argv[scopeIdx + 1]! : "@qingchen";

const FFMPEG_VERSION = "8.1.1";
const WHISPER_VERSION = "1.8.6";

function which(name: string): string {
  const r = spawnSync("powershell", ["-NoProfile", "-Command", `(Get-Command ${name}).Source`], {
    encoding: "utf8",
    windowsHide: true,
  });
  const p = r.stdout.trim();
  if (!p) throw new Error(`找不到 ${name}，先确保其在 PATH 中`);
  return p;
}

interface Pkg {
  dirName: string;
  name: string;
  version: string;
  description: string;
  payload: { from: string; to: string }[];
}

const packages: Pkg[] = [
  {
    dirName: "ffmpeg-win32-x64",
    name: `${scope}/ffmpeg-win32-x64`,
    version: FFMPEG_VERSION,
    description: "FFmpeg full 静态构建（含 libass/drawtext/xfade），晴辰剪辑 vendored 二进制",
    payload: [{ from: which("ffmpeg"), to: "bin/ffmpeg.exe" }],
  },
  {
    dirName: "ffprobe-win32-x64",
    name: `${scope}/ffprobe-win32-x64`,
    version: FFMPEG_VERSION,
    description: "FFprobe full 静态构建，晴辰剪辑 vendored 二进制",
    payload: [{ from: which("ffprobe"), to: "bin/ffprobe.exe" }],
  },
  {
    dirName: "whisper-win32-x64",
    name: `${scope}/whisper-win32-x64`,
    version: WHISPER_VERSION,
    description: "whisper.cpp whisper-cli 预编译二进制（模型另行下载），晴辰剪辑 vendored 二进制",
    payload: [
      { from: join(root, "vendor", "whisper", "whisper-cli.exe"), to: "bin/whisper-cli.exe" },
      ...readdirSync(join(root, "vendor", "whisper"))
        .filter((f) => f.endsWith(".dll"))
        .map((f) => ({ from: join(root, "vendor", "whisper", f), to: `bin/${f}` })),
    ],
  },
];

for (const pkg of packages) {
  const dir = join(outRoot, pkg.dirName);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "bin"), { recursive: true });
  for (const { from, to } of pkg.payload) {
    copyFileSync(from, join(dir, to));
  }
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        license: "MIT",
        os: ["win32"],
        cpu: ["x64"],
        files: ["bin"],
        repository: { type: "git", url: "https://github.com/qingchencloud/qingchen-cut.git" },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.error(`打包完成: ${dir}`);
}

console.log(JSON.stringify({ ok: true, scope, packages: packages.map((p) => `${p.name}@${p.version}`) }, null, 2));
