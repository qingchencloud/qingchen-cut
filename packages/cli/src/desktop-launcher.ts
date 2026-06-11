import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { startStudioServer } from "./studio";

export interface DesktopRuntimePaths {
  appDir: string;
  binDir: string;
  modelDir: string;
  defaultOutDir: string;
}

export interface BundledRuntimeResult {
  ffmpeg?: string;
  whisper?: string;
  whisperModel?: string;
}

export interface DesktopClientOptions {
	host?: string;
	port?: number;
	openBrowser?: boolean;
	executablePath?: string;
	homeDir?: string;
}

export interface PackagedWebRuntime {
	host: string;
	port: number;
	url: string;
	bunExe: string;
	serverJs: string;
	serverDir: string;
	webDir: string;
}

export function resolveDesktopRuntimePaths(
  executablePath = process.execPath,
  userHome = homedir(),
): DesktopRuntimePaths {
  const appDir = dirname(resolve(executablePath));
  return {
    appDir,
    binDir: join(appDir, "bin"),
    modelDir: join(appDir, "models"),
    defaultOutDir: join(userHome, "Videos", "Qingchen Cut"),
  };
}

export function configureBundledRuntime(paths: DesktopRuntimePaths): BundledRuntimeResult {
  const ffmpegExe = join(paths.binDir, "ffmpeg.exe");
  const ffprobeExe = join(paths.binDir, "ffprobe.exe");
  const whisperExe = join(paths.binDir, "whisper-cli.exe");
  const baseModel = join(paths.modelDir, "ggml-base.bin");
  const configured: BundledRuntimeResult = {};

  if (existsSync(ffmpegExe) && existsSync(ffprobeExe)) {
    process.env["QC_FFMPEG_PATH"] = paths.binDir;
    configured.ffmpeg = paths.binDir;
  }
  if (existsSync(whisperExe)) {
    process.env["QC_WHISPER_PATH"] = whisperExe;
    configured.whisper = whisperExe;
  }
  if (existsSync(baseModel)) {
    process.env["QC_WHISPER_MODEL"] = baseModel;
    configured.whisperModel = baseModel;
  }
	return configured;
}

export function resolvePackagedWebRuntime(
	paths: DesktopRuntimePaths,
	opts: { host?: string; port?: number } = {},
): PackagedWebRuntime {
	const host = opts.host ?? "127.0.0.1";
	const port = opts.port ?? 4477;
	const webDir = join(paths.appDir, "web");
	const standaloneServerJs = join(webDir, "apps", "web", "server.js");
	const flatServerJs = join(webDir, "server.js");
	const serverJs = existsSync(standaloneServerJs)
		? standaloneServerJs
		: flatServerJs;
	return {
		host,
		port,
		url: `http://${host}:${port}/projects`,
		bunExe: join(paths.appDir, "runtime", "bun.exe"),
		serverJs,
		serverDir: dirname(serverJs),
		webDir,
	};
}

export function createPackagedWebEnv(
	paths: DesktopRuntimePaths,
	web: PackagedWebRuntime,
): NodeJS.ProcessEnv {
	return {
		...process.env,
		NODE_ENV: "production",
		QC_LOCAL_CLIENT: "1",
		NEXT_PUBLIC_QC_CLIENT_MODE: "desktop",
		NEXT_PUBLIC_SITE_URL: `http://${web.host}:${web.port}`,
		PORT: String(web.port),
		HOSTNAME: web.host,
		QC_FFMPEG_PATH: paths.binDir,
		QC_WHISPER_PATH: join(paths.binDir, "whisper-cli.exe"),
		QC_WHISPER_MODEL: join(paths.modelDir, "ggml-base.bin"),
	};
}

function openUrl(url: string): void {
  const child =
    process.platform === "win32"
      ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true })
      : process.platform === "darwin"
        ? spawn("open", [url], { detached: true, stdio: "ignore" })
        : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  child.unref();
}

export function startDesktopClient(opts: DesktopClientOptions = {}): {
  url: string;
  paths: DesktopRuntimePaths;
  bundledRuntime: BundledRuntimeResult;
  server: ReturnType<typeof startStudioServer>["server"];
} {
  const paths = resolveDesktopRuntimePaths(opts.executablePath, opts.homeDir);
  mkdirSync(paths.defaultOutDir, { recursive: true });
  const bundledRuntime = configureBundledRuntime(paths);
  const { url, server } = startStudioServer({
    repoRoot: paths.appDir,
    defaultOutDir: paths.defaultOutDir,
    host: opts.host ?? "127.0.0.1",
    port: opts.port ?? 4477,
  });
  if (opts.openBrowser ?? true) openUrl(url);
	return { url, paths, bundledRuntime, server };
}

export function startPackagedWebClient(opts: DesktopClientOptions = {}): {
	url: string;
	paths: DesktopRuntimePaths;
	bundledRuntime: BundledRuntimeResult;
	process: ReturnType<typeof spawn>;
} {
	const paths = resolveDesktopRuntimePaths(opts.executablePath, opts.homeDir);
	mkdirSync(paths.defaultOutDir, { recursive: true });
	const bundledRuntime = configureBundledRuntime(paths);
	const web = resolvePackagedWebRuntime(paths, {
		host: opts.host ?? "127.0.0.1",
		port: opts.port ?? 4477,
	});

	const exe = existsSync(web.bunExe) ? web.bunExe : process.execPath;
	if (!existsSync(web.serverJs)) {
		throw new Error(`缺少 Web 客户端服务入口: ${web.serverJs}`);
	}

	const child = spawn(exe, [web.serverJs], {
		cwd: web.serverDir,
		env: createPackagedWebEnv(paths, web),
		windowsHide: true,
		stdio: "ignore",
	});
	child.unref();

	if (opts.openBrowser ?? true) {
		setTimeout(() => openUrl(web.url), 800);
	}
	return { url: web.url, paths, bundledRuntime, process: child };
}
