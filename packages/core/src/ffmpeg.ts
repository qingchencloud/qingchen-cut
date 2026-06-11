import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export type ToolName = "ffmpeg" | "ffprobe";

export interface ResolvedTool {
  path: string;
  /** 二进制来源，doctor 会展示 */
  source: "env" | "vendored" | "system-path";
}

/** 单二进制 vendored npm 包候选名（org scope 优先，个人 scope 兜底） */
const VENDORED_PACKAGES: Record<ToolName, string[]> = {
  ffmpeg: ["@qingchen/ffmpeg-win32-x64", "@qq1186258278/ffmpeg-win32-x64"],
  ffprobe: ["@qingchen/ffprobe-win32-x64", "@qq1186258278/ffprobe-win32-x64"],
};

/** 在已安装的 vendored npm 包里找二进制（bin/<exe>） */
export function resolveVendoredBin(packageNames: string[], exe: string): string | null {
  for (const pkg of packageNames) {
    try {
      const pkgJson = import.meta.resolve?.(`${pkg}/package.json`);
      if (!pkgJson) continue;
      const dir = dirname(new URL(pkgJson).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
      const candidate = join(dir, "bin", exe);
      if (existsSync(candidate)) return candidate;
    } catch {
      // 该包未安装，试下一个候选
    }
  }
  return null;
}

/**
 * FFmpeg/FFprobe 解析顺序：
 * 1. 环境变量 QC_FFMPEG_PATH（指向 ffmpeg.exe 或其所在目录）
 * 2. vendored npm 包（script/build-binary-packages.ts 产出）
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

  const vendored = resolveVendoredBin(VENDORED_PACKAGES[name], exe);
  if (vendored) return { path: vendored, source: "vendored" };

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
