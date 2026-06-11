#!/usr/bin/env bun
/**
 * 构建 Windows 本地客户端包：
 * dist/qingchen-cut-win32-x64/
 *   QingchenCut.exe            单文件 launcher，启动原 Web 编辑器
 *   runtime/bun.exe            内置 Bun runtime，用于运行 Next standalone
 *   web/apps/web/server.js     apps/web 的 Next standalone 入口
 *   bin/ffmpeg.exe             内置 FFmpeg
 *   bin/ffprobe.exe            内置 FFprobe
 *   bin/whisper-cli.exe        可选：存在 vendor/whisper 时复制
 *   models/ggml-base.bin       可选：存在 vendor/models 时复制
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = join(import.meta.dir, "..");
const outDir = join(root, "dist", "qingchen-cut-win32-x64");
const exePath = join(outDir, "QingchenCut.exe");
const binDir = join(outDir, "bin");
const modelsDir = join(outDir, "models");
const runtimeDir = join(outDir, "runtime");
const webOutDir = join(outDir, "web");

function run(
  command: string,
  args: string[],
  label: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd = root,
): void {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    stdio: "pipe",
    env,
  });
  if (result.status !== 0) {
    throw new Error(`${label} 失败 (exit ${result.status})\n${result.stdout}\n${result.stderr}`);
  }
}

function which(name: string): string {
  const result = spawnSync("powershell", ["-NoProfile", "-Command", `(Get-Command ${name}).Source`], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  const p = result.stdout.trim();
  if (!p || !existsSync(p)) throw new Error(`找不到 ${name}，请先安装或放到 PATH`);
  return p;
}

function copyRequired(from: string, to: string): void {
  if (!existsSync(from)) throw new Error(`缺少必需文件: ${from}`);
  copyFileSync(from, to);
}

function copyOptionalFile(from: string, to: string): boolean {
  if (!existsSync(from)) return false;
  mkdirSync(join(to, ".."), { recursive: true });
  copyFileSync(from, to);
  return true;
}

function copyDir(from: string, to: string, opts: { skipNodeModules?: boolean } = {}): void {
  const name = basename(from);
  if (opts.skipNodeModules && name === "node_modules") return;

  const stat = lstatSync(from);
  if (stat.isSymbolicLink()) {
    throw new Error(`不复制符号链接，请改为真实文件依赖: ${from}`);
  }
  if (stat.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const child of readdirSync(from)) {
      copyDir(join(from, child), join(to, child), opts);
    }
    return;
  }
  copyFileSync(from, to);
}

function size(file: string): number {
  return existsSync(file) ? statSync(file).size : 0;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });
mkdirSync(modelsDir, { recursive: true });
mkdirSync(runtimeDir, { recursive: true });
mkdirSync(webOutDir, { recursive: true });

run(
  process.execPath,
  ["run", "build:web"],
  "Next standalone build",
  {
    ...process.env,
    NODE_ENV: "production",
    QC_LOCAL_CLIENT: "1",
    NEXT_PUBLIC_QC_CLIENT_MODE: "desktop",
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:4477",
    PORT: "4477",
  },
);

run(
  process.execPath,
  ["build", "--compile", "--outfile", exePath, join(root, "packages", "cli", "src", "qingchen-cut-studio.ts")],
  "Bun compile",
);

copyRequired(process.execPath, join(runtimeDir, "bun.exe"));
copyRequired(which("ffmpeg"), join(binDir, "ffmpeg.exe"));
copyRequired(which("ffprobe"), join(binDir, "ffprobe.exe"));

const standaloneRoot = join(root, "apps", "web", ".next", "standalone");
copyDir(standaloneRoot, webOutDir, { skipNodeModules: true });
const packagedServerJs = join(webOutDir, "apps", "web", "server.js");
if (!existsSync(packagedServerJs)) throw new Error(`缺少 Next standalone 服务入口: ${packagedServerJs}`);
const packagedWebAppDir = join(webOutDir, "apps", "web");
run(
  process.execPath,
  ["install", "--production", "--no-save", "--backend=copyfile", "--linker=hoisted"],
  "安装 Web 生产依赖",
  process.env,
  packagedWebAppDir,
);
const staticDir = join(root, "apps", "web", ".next", "static");
if (existsSync(staticDir)) {
  copyDir(staticDir, join(webOutDir, "apps", "web", ".next", "static"));
}
const publicDir = join(root, "apps", "web", "public");
if (existsSync(publicDir)) {
  copyDir(publicDir, join(webOutDir, "apps", "web", "public"));
}

const whisperDir = join(root, "vendor", "whisper");
const copiedWhisper: string[] = [];
if (existsSync(join(whisperDir, "whisper-cli.exe"))) {
  copyRequired(join(whisperDir, "whisper-cli.exe"), join(binDir, "whisper-cli.exe"));
  copiedWhisper.push("whisper-cli.exe");
  for (const file of readdirSync(whisperDir)) {
    if (file.toLowerCase().endsWith(".dll")) {
      copyRequired(join(whisperDir, file), join(binDir, file));
      copiedWhisper.push(file);
    }
  }
}

const copiedModels: string[] = [];
const vendorModels = join(root, "vendor", "models");
if (existsSync(vendorModels)) {
  for (const file of readdirSync(vendorModels)) {
    if (file.toLowerCase().endsWith(".bin")) {
      copyRequired(join(vendorModels, file), join(modelsDir, file));
      copiedModels.push(file);
    }
  }
}

const readme = `晴辰剪辑 Windows 客户端

启动方式：
1. 双击 QingchenCut.exe
2. 程序会在本机启动原 Web 编辑器，并自动打开 http://127.0.0.1:4477/projects
3. 默认输出目录：%USERPROFILE%\\Videos\\Qingchen Cut

内置内容：
- Qingchen Cut launcher
- 原 OpenCut Web 编辑器（已进入本地客户端模式）
- Bun runtime（仅随客户端内部使用，用户不需要安装）
- FFmpeg / FFprobe
${copiedWhisper.length > 0 ? "- whisper.cpp（可选转写）\n" : ""}${copiedModels.length > 0 ? "- whisper 模型\n" : ""}
命令行参数：
QingchenCut.exe --port 4478
QingchenCut.exe --no-open

注意：
- 当前版本是本地客户端包，界面使用原 Web 编辑器并通过本机浏览器显示。
- 所有素材路径和输出都在本机，不会上传。
`;
writeFileSync(join(outDir, "README.txt"), readme, "utf8");

const manifest = {
  ok: true,
  name: "qingchen-cut",
  platform: "win32-x64",
  exe: exePath,
  files: {
    exeBytes: size(exePath),
    runtimeBytes: size(join(runtimeDir, "bun.exe")),
    webServerBytes: size(packagedServerJs),
    ffmpegBytes: size(join(binDir, "ffmpeg.exe")),
    ffprobeBytes: size(join(binDir, "ffprobe.exe")),
    whisper: copiedWhisper,
    models: copiedModels,
  },
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(JSON.stringify({ ...manifest, outDir, files: readdirSync(outDir).map((file) => basename(file)) }, null, 2));
