import {
  analyzeMedia,
  contactSheet,
  createNarratedJobFile,
  parseNarrationScript,
  renderJob,
  runDoctor,
  synthesizeNarration,
  validateJobFile,
} from "@qingchen/cut-core";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface StudioServices {
  runDoctor: typeof runDoctor;
  analyzeMedia: typeof analyzeMedia;
  parseNarrationScript: typeof parseNarrationScript;
  synthesizeNarration: typeof synthesizeNarration;
  createNarratedJobFile: typeof createNarratedJobFile;
  validateJobFile: typeof validateJobFile;
  renderJob: typeof renderJob;
  contactSheet: typeof contactSheet;
}

export interface StudioOptions {
  repoRoot: string;
  defaultOutDir: string;
  services?: StudioServices;
}

export interface StartStudioOptions extends StudioOptions {
  host?: string;
  port?: number;
}

const defaultServices: StudioServices = {
  runDoctor,
  analyzeMedia,
  parseNarrationScript,
  synthesizeNarration,
  createNarratedJobFile,
  validateJobFile,
  renderJob,
  contactSheet,
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const raw = await request.json();
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function runId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  return `studio-${stamp}`;
}

function contentType(filePath: string): string {
  if (/\.png$/i.test(filePath)) return "image/png";
  if (/\.jpe?g$/i.test(filePath)) return "image/jpeg";
  if (/\.mp4$/i.test(filePath)) return "video/mp4";
  if (/\.json$/i.test(filePath)) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function studioHtml(defaultOutDir: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>晴辰剪辑 Studio</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f4f2ed;
      --panel: #ffffff;
      --text: #171717;
      --muted: #62615d;
      --line: #d9d6cd;
      --accent: #087f7a;
      --accent-strong: #075e5b;
      --danger: #b3261e;
      --code: #272822;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #161615;
        --panel: #22211f;
        --text: #f4f2ed;
        --muted: #b5b0a7;
        --line: #3a3936;
        --accent: #2dd4bf;
        --accent-strong: #5eead4;
        --danger: #ffb4ab;
        --code: #111111;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 24px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 650;
      letter-spacing: 0;
    }
    main {
      display: grid;
      grid-template-columns: minmax(360px, 480px) minmax(0, 1fr);
      gap: 18px;
      padding: 18px;
      max-width: 1480px;
      margin: 0 auto;
    }
    section {
      min-width: 0;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
    }
    .stack { display: grid; gap: 12px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    label {
      display: grid;
      gap: 6px;
      font-size: 13px;
      color: var(--muted);
    }
    input, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px 11px;
      background: transparent;
      color: var(--text);
      font: inherit;
      letter-spacing: 0;
    }
    textarea {
      min-height: 170px;
      resize: vertical;
      line-height: 1.55;
    }
    button {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: transparent;
      color: var(--text);
      padding: 9px 12px;
      font: inherit;
      cursor: pointer;
    }
    button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #ffffff;
    }
    button:disabled { opacity: 0.58; cursor: wait; }
    .status {
      font-size: 13px;
      color: var(--muted);
      min-height: 20px;
    }
    .status.error { color: var(--danger); }
    .preview {
      display: grid;
      grid-template-rows: auto minmax(240px, 1fr) minmax(180px, 32vh);
      gap: 12px;
      min-height: calc(100vh - 112px);
    }
    .media {
      width: 100%;
      min-height: 240px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #0f0f0f;
      object-fit: contain;
    }
    .log {
      margin: 0;
      overflow: auto;
      border-radius: 8px;
      padding: 12px;
      background: var(--code);
      color: #f8f8f2;
      font: 12px/1.5 "Cascadia Mono", Consolas, monospace;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .paths {
      display: grid;
      gap: 4px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    @media (max-width: 900px) {
      main { grid-template-columns: 1fr; padding: 12px; }
      header { padding: 14px 16px; align-items: flex-start; flex-direction: column; }
      .preview { min-height: auto; grid-template-rows: auto auto minmax(180px, 34vh); }
    }
  </style>
</head>
<body>
  <header>
    <h1>晴辰剪辑 Studio</h1>
    <button id="doctorBtn" type="button">Doctor</button>
  </header>
  <main>
    <section class="panel stack">
      <label>视频路径
        <input id="videoPath" autocomplete="off" placeholder="D:\\\\media\\\\input.mp4" />
      </label>
      <label>BGM 路径
        <input id="bgmPath" autocomplete="off" placeholder="D:\\\\media\\\\bgm.mp3" />
      </label>
      <label>标题
        <input id="title" autocomplete="off" value="晴辰剪辑" />
      </label>
      <label>输出目录
        <input id="outDir" autocomplete="off" value="${escapeHtml(defaultOutDir)}" />
      </label>
      <label>文案 / 配音稿
        <textarea id="script">第一段配音文案。
第二段配音和画面同步。</textarea>
      </label>
      <div class="row">
        <button id="analyzeBtn" type="button">分析素材</button>
        <button id="generateBtn" class="primary" type="button">生成成片</button>
      </div>
      <div id="status" class="status"></div>
      <div id="paths" class="paths"></div>
    </section>
    <section class="preview">
      <video id="videoPreview" class="media" controls playsinline></video>
      <img id="sheetPreview" class="media" alt="contact sheet" />
      <pre id="log" class="log">{}</pre>
    </section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    const status = $("status");
    const log = $("log");
    const paths = $("paths");
    const controls = [$("doctorBtn"), $("analyzeBtn"), $("generateBtn")];

    function payload() {
      return {
        videoPath: $("videoPath").value,
        bgmPath: $("bgmPath").value,
        title: $("title").value,
        outDir: $("outDir").value,
        script: $("script").value
      };
    }
    function setBusy(value, label) {
      controls.forEach((el) => el.disabled = value);
      status.textContent = label || "";
      status.classList.remove("error");
    }
    function show(data) {
      log.textContent = JSON.stringify(data, null, 2);
      if (data && data.ok === false) {
        status.classList.add("error");
        status.textContent = data.error || "任务失败";
      }
    }
    async function call(url, options) {
      const res = await fetch(url, options);
      const data = await res.json();
      show(data);
      if (!res.ok || data.ok === false) throw new Error(data.error || "请求失败");
      return data;
    }
    $("doctorBtn").addEventListener("click", async () => {
      try {
        setBusy(true, "检查环境");
        await call("/api/doctor");
        status.textContent = "Doctor 完成";
      } catch (e) {
        status.classList.add("error");
        status.textContent = e.message;
      } finally {
        controls.forEach((el) => el.disabled = false);
      }
    });
    $("analyzeBtn").addEventListener("click", async () => {
      try {
        setBusy(true, "分析素材");
        await call("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ videoPath: $("videoPath").value })
        });
        status.textContent = "素材分析完成";
      } catch (e) {
        status.classList.add("error");
        status.textContent = e.message;
      } finally {
        controls.forEach((el) => el.disabled = false);
      }
    });
    $("generateBtn").addEventListener("click", async () => {
      try {
        setBusy(true, "生成中");
        const data = await call("/api/jobs/narrated-video", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload())
        });
        if (data.videoUrl) $("videoPreview").src = data.videoUrl;
        if (data.sheetUrl) $("sheetPreview").src = data.sheetUrl;
        const lines = [
          data.jobPath ? "DSL: " + data.jobPath : "",
          data.outputPath ? "MP4: " + data.outputPath : "",
          data.sheetPath ? "速览: " + data.sheetPath : ""
        ].filter(Boolean);
        paths.replaceChildren(...lines.map((line) => {
          const el = document.createElement("div");
          el.textContent = line;
          return el;
        }));
        status.textContent = "生成完成";
      } catch (e) {
        status.classList.add("error");
        status.textContent = e.message;
      } finally {
        controls.forEach((el) => el.disabled = false);
      }
    });
  </script>
</body>
</html>`;
}

function fileUrl(filePath: string): string {
  return `/api/file?path=${encodeURIComponent(resolve(filePath))}`;
}

export function createStudioFetch(options: StudioOptions): (request: Request) => Promise<Response> {
  const repoRoot = resolve(options.repoRoot);
  const defaultOutDir = resolve(options.defaultOutDir);
  const services = options.services ?? defaultServices;
  const servableFiles = new Set<string>();
  mkdirSync(defaultOutDir, { recursive: true });

  async function runNarratedVideo(body: Record<string, unknown>): Promise<Response> {
    const videoPath = text(body.videoPath);
    const script = text(body.script);
    if (!videoPath || !script) {
      return json({ ok: false, error: "videoPath 和 script 为必填项" }, 400);
    }

    const outDir = resolve(text(body.outDir) ?? join(defaultOutDir, runId()));
    const baseName = text(body.baseName) ?? "studio";
    const jobPath = resolve(text(body.jobPath) ?? join(outDir, `${baseName}-job.json`));
    const outputPath = resolve(text(body.outputPath) ?? join(outDir, `${baseName}.mp4`));
    const sheetPath = resolve(text(body.sheetPath) ?? join(outDir, "contact-sheet.png"));
    mkdirSync(outDir, { recursive: true });

    const analysis = await services.analyzeMedia(videoPath);
    if (!analysis.ok) {
      return json({ ok: false, step: "analyze", analysis, issues: analysis.issues }, 200);
    }

    const parsed = services.parseNarrationScript(script);
    if (!parsed.ok || !parsed.segments) {
      return json({ ok: false, step: "parse-script", parsed, issues: parsed.issues }, 400);
    }

    const narration = await services.synthesizeNarration({
      segments: parsed.segments,
      outDir: join(outDir, "narration"),
      baseName,
      ...(text(body.voice) ? { voice: text(body.voice) } : {}),
      ...(number(body.rate) !== undefined ? { rate: number(body.rate) } : {}),
      ...(number(body.volume) !== undefined ? { volume: number(body.volume) } : {}),
    });
    if (!narration.ok) {
      return json({ ok: false, step: "tts", analysis, parsed, narration, issues: narration.issues }, 200);
    }

    const job = await services.createNarratedJobFile({
      narration,
      videoPath,
      ...(text(body.bgmPath) ? { bgmPath: text(body.bgmPath) } : {}),
      jobPath,
      outputPath,
      title: text(body.title) ?? parsed.title,
      project: {
        name: text(body.title) ?? "Qingchen Studio",
        canvas: { width: 1080, height: 1920 },
        fps: 30,
      },
    });
    if (!job.ok) {
      return json({ ok: false, step: "create-job", analysis, parsed, narration, job, issues: job.issues }, 200);
    }

    const validation = await services.validateJobFile(jobPath);
    if (!validation.ok) {
      return json({ ok: false, step: "validate", analysis, parsed, narration, job, validation, issues: validation.issues }, 200);
    }

    const render = await services.renderJob(jobPath, { keepTemp: body.keepTemp === true });
    if (!render.ok) {
      return json({ ok: false, step: "render", analysis, parsed, narration, job, validation, render, issues: render.issues }, 200);
    }

    const sheet = await services.contactSheet(render.output ?? outputPath, sheetPath, { cols: 3, rows: 3 });
    const ok = sheet.ok;
    for (const p of [jobPath, render.output, outputPath, sheet.output, sheetPath]) {
      if (p) servableFiles.add(resolve(p));
    }
    return json({
      ok,
      step: ok ? "done" : "contact-sheet",
      outDir,
      jobPath,
      outputPath: render.output ?? outputPath,
      sheetPath: sheet.output ?? sheetPath,
      videoUrl: render.output ? fileUrl(render.output) : existsSync(outputPath) ? fileUrl(outputPath) : undefined,
      sheetUrl: sheet.output ? fileUrl(sheet.output) : existsSync(sheetPath) ? fileUrl(sheetPath) : undefined,
      analysis,
      parsed: { ok: parsed.ok, title: parsed.title, segments: parsed.segments },
      narration,
      job,
      validation,
      render,
      sheet,
      issues: sheet.issues,
    });
  }

  return async function studioFetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(studioHtml(defaultOutDir), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (request.method === "GET" && url.pathname === "/api/status") {
      return json({ ok: true, repoRoot, defaultOutDir });
    }
    if (request.method === "GET" && url.pathname === "/api/doctor") {
      return json(await services.runDoctor());
    }
    if (request.method === "GET" && url.pathname === "/api/file") {
      const filePath = text(url.searchParams.get("path"));
      const resolved = filePath ? resolve(filePath) : "";
      if (!resolved || !servableFiles.has(resolved) || !existsSync(resolved)) {
        return json({ ok: false, error: "文件不可访问或不存在" }, 404);
      }
      return new Response(Bun.file(resolved), {
        headers: { "content-type": contentType(resolved) },
      });
    }
    if (request.method === "POST" && url.pathname === "/api/analyze") {
      const body = await readJson(request);
      const videoPath = text(body.videoPath);
      if (!videoPath) return json({ ok: false, error: "videoPath 为必填项" }, 400);
      return json(await services.analyzeMedia(videoPath));
    }
    if (request.method === "POST" && url.pathname === "/api/jobs/narrated-video") {
      return runNarratedVideo(await readJson(request));
    }
    if (request.method === "POST" && url.pathname === "/api/contact-sheet") {
      const body = await readJson(request);
      const targetPath = text(body.targetPath);
      const outPng = text(body.outPng);
      if (!targetPath || !outPng) return json({ ok: false, error: "targetPath 和 outPng 为必填项" }, 400);
      const result = await services.contactSheet(targetPath, outPng, {
        ...(number(body.cols) !== undefined ? { cols: number(body.cols) } : {}),
        ...(number(body.rows) !== undefined ? { rows: number(body.rows) } : {}),
      });
      if (result.output) servableFiles.add(resolve(result.output));
      return json({ ...result, sheetUrl: result.output ? fileUrl(result.output) : undefined });
    }
    return json({ ok: false, error: `未知路径: ${request.method} ${url.pathname}` }, 404);
  };
}

export function startStudioServer(options: StartStudioOptions): { url: string; server: ReturnType<typeof Bun.serve> } {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4477;
  const fetch = createStudioFetch(options);
  const server = Bun.serve({ hostname: host, port, fetch });
  return { url: `http://${server.hostname}:${server.port}`, server };
}
