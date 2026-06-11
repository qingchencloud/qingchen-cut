import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export type ToolName = "ffmpeg" | "ffprobe";

export interface ResolvedTool {
  path: string;
  /** 二进制来源，doctor 会展示 */
  source: "env" | "vendored" | "system-path";
}

/**
 * FFmpeg/FFprobe 解析顺序：
 * 1. 环境变量 QC_FFMPEG_PATH（指向 ffmpeg.exe 或其所在目录）
 * 2. vendored npm 包 @qingchen/ffmpeg-win32-x64
 * 3. 系统 PATH
 */
export function resolveTool(name: ToolName): ResolvedTool | null {
  const exe = process.platform === "win32" ? `${name}.exe` : name;

  const envPath = process.env["QC_FFMPEG_PATH"];
  if (envPath && existsSync(envPath)) {
    const dir = statSync(envPath).isDirectory() ? envPath : dirname(envPath);
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return { path: candidate, source: "env" };
  }

  try {
    const pkgJson = import.meta.resolve?.("@qingchen/ffmpeg-win32-x64/package.json");
    if (pkgJson) {
      const dir = dirname(new URL(pkgJson).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
      const candidate = join(dir, "bin", exe);
      if (existsSync(candidate)) return { path: candidate, source: "vendored" };
    }
  } catch {
    // vendored 包未安装，继续向下找
  }

  const fromPath = typeof Bun !== "undefined" ? Bun.which(name) : null;
  if (fromPath) return { path: fromPath, source: "system-path" };

  return null;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 运行子进程。参数永远走数组传参，不经过 shell，避免 Windows 转义问题。 */
export function run(
  exePath: string,
  args: string[],
  opts: { onStderrLine?: (line: string) => void; timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let stderrBuf = "";
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill();
          reject(new Error(`进程超时（${opts.timeoutMs}ms）: ${exePath}`));
        }, opts.timeoutMs)
      : null;

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => {
      const text = d.toString("utf8");
      stderr += text;
      if (opts.onStderrLine) {
        stderrBuf += text;
        let nl: number;
        while ((nl = stderrBuf.search(/[\r\n]/)) >= 0) {
          const line = stderrBuf.slice(0, nl);
          stderrBuf = stderrBuf.slice(nl + 1);
          if (line.trim()) opts.onStderrLine(line);
        }
      }
    });
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
