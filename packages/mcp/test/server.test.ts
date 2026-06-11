import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { resolveTool } from "@qingchen/cut-core";

/**
 * 端到端冒烟：以子进程启动 MCP server，走真实 stdio JSON-RPC。
 */
const repoRoot = join(import.meta.dir, "..", "..", "..");
const serverPath = join(repoRoot, "packages", "mcp", "src", "server.ts");
const fixturesDir = join(repoRoot, "fixtures");
const hasFFmpeg = resolveTool("ffmpeg") !== null && resolveTool("ffprobe") !== null;

let child: ChildProcess;
let buffer = "";
const pending = new Map<number, (msg: any) => void>();

function send(msg: object): void {
  child.stdin!.write(JSON.stringify(msg) + "\n");
}

function request(id: number, method: string, params: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP 请求超时: ${method}`)), 30_000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

beforeAll(async () => {
  child = spawn(process.execPath, [serverPath], { cwd: repoRoot, windowsHide: true });
  child.stdout!.on("data", (d: Buffer) => {
    buffer += d.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)!(msg);
          pending.delete(msg.id);
        }
      } catch {
        // 忽略非 JSON 行
      }
    }
  });

  const init = await request(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.0" },
  });
  expect(init.result.serverInfo.name).toBe("qingchen-cut");
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
}, 30_000);

afterAll(() => {
  child?.kill();
});

describe("MCP server 冒烟", () => {
  test("tools/list 暴露全部 15 个工具", async () => {
    const res = await request(2, "tools/list", {});
    const names = res.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(
      [
        "analyze_media",
        "contact_sheet",
        "create_narrated_dsl",
        "doctor",
        "extract_frame",
        "get_dsl_schema",
        "patch_dsl",
        "plan_render",
        "probe_media",
        "render_batch",
        "render_template",
        "render_video",
        "synthesize_speech",
        "transcribe_media",
        "validate_dsl",
      ].sort(),
    );
  }, 30_000);

  test("tools/call get_dsl_schema 返回 JSON Schema", async () => {
    const res = await request(3, "tools/call", { name: "get_dsl_schema", arguments: {} });
    const text = res.result.content[0].text;
    expect(text).toContain("Editing DSL v1");
  }, 30_000);

  test("tools/call validate_dsl 校验 fixture", async () => {
    const res = await request(4, "tools/call", {
      name: "validate_dsl",
      arguments: { jobPath: join(repoRoot, "fixtures", "jobs", "valid-minimal.json"), skipProbe: true },
    });
    const parsed = JSON.parse(res.result.content[0].text);
    expect(parsed.ok).toBe(true);
  }, 30_000);

  test("tools/call validate_dsl 非法任务 → isError + 结构化 issues", async () => {
    const res = await request(5, "tools/call", {
      name: "validate_dsl",
      arguments: { jobPath: join(repoRoot, "fixtures", "jobs", "invalid-bad-asset-ref.json"), skipProbe: true },
    });
    expect(res.result.isError).toBe(true);
    const parsed = JSON.parse(res.result.content[0].text);
    expect(parsed.issues.some((i: any) => i.code === "DSL_UNKNOWN_ASSET_REF")).toBe(true);
  }, 30_000);

  test.if(hasFFmpeg && process.platform === "win32")("tools/call synthesize_speech 生成 WAV", async () => {
    const outWav = join(fixturesDir, "out", "mcp-tts.wav");
    rmSync(outWav, { force: true });
    const res = await request(6, "tools/call", {
      name: "synthesize_speech",
      arguments: { text: "MCP 配音工具测试。", outWav },
    });
    const parsed = JSON.parse(res.result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.durationSec).toBeGreaterThan(0);
    expect(existsSync(outWav)).toBe(true);
  }, 120_000);
});
