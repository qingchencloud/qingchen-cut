#!/usr/bin/env bun
/**
 * 晴辰剪辑 MCP server（stdio）。
 * 薄封装 @qingchen/cut-core，工具一比一映射 core 函数，不承载剪辑业务逻辑。
 * 所有工具返回 JSON 文本；失败时 isError=true 且 JSON 内含结构化 issues。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getJobJsonSchema } from "@qingchen/cut-dsl";
import {
  analyzeMedia,
  contactSheet,
  extractFrame,
  patchJobFile,
  planJob,
  probeMedia,
  renderJob,
  runDoctor,
  transcribeMedia,
  validateJobFile,
} from "@qingchen/cut-core";

const server = new McpServer({ name: "qingchen-cut", version: "0.1.0" });

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function jsonResult(data: unknown, ok: boolean): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    ...(ok ? {} : { isError: true }),
  };
}

/**
 * registerTool 的类型擦除封装：SDK 的泛型在 zod 复杂 schema 上会触发
 * TS2589（实例化过深）甚至 tsc OOM；运行时校验行为不变。
 */
function tool(
  name: string,
  config: { description: string; inputSchema: Record<string, z.ZodTypeAny> },
  handler: (args: any) => Promise<ToolResult>,
): void {
  (server as any).registerTool(name, config, handler);
}

tool(
  "get_dsl_schema",
  {
    description:
      "获取 Editing DSL v1 的 JSON Schema（含每个字段的中文说明）。写或改剪辑任务 JSON 前先调用本工具，照 schema 生成 DSL。",
    inputSchema: {},
  },
  async () => jsonResult(getJobJsonSchema(), true),
);

tool(
  "doctor",
  {
    description: "环境诊断：FFmpeg/FFprobe 是否在位、关键滤镜（字幕/文字/转场）可用性、中文字体。剪辑链路报错时先跑这个。",
    inputSchema: {},
  },
  async () => {
    const report = await runDoctor();
    return jsonResult(report, report.ok);
  },
);

tool(
  "validate_dsl",
  {
    description:
      "校验剪辑任务 JSON 文件：schema、语义（转场约束/素材引用）、素材文件存在性、ffprobe 深度校验（in/out 是否超出素材时长）。返回结构化 issues，每条带修复建议。渲染前必跑。",
    inputSchema: {
      jobPath: z.string().describe("DSL 任务 JSON 文件的本地路径"),
      skipProbe: z.boolean().optional().describe("跳过 ffprobe 深度校验（更快，默认 false）"),
    },
  },
  async ({ jobPath, skipProbe }) => {
    const result = await validateJobFile(jobPath, { skipProbe: skipProbe ?? false });
    return jsonResult(result, result.ok);
  },
);

tool(
  "probe_media",
  {
    description: "读取本地媒体文件元数据：时长、分辨率、帧率、旋转、音轨信息。",
    inputSchema: { path: z.string().describe("媒体文件本地路径") },
  },
  async ({ path }) => {
    const result = await probeMedia(path);
    return jsonResult(result, result.issues.length === 0);
  },
);

tool(
  "analyze_media",
  {
    description:
      "深度分析素材：场景切换点（atSec+score）、静音段、综合响度（LUFS）。做粗剪决策（在哪切、删哪段）的依据。",
    inputSchema: {
      path: z.string().describe("媒体文件本地路径"),
      sceneThreshold: z.number().min(0).max(1).optional().describe("场景切换灵敏度，默认 0.3，越低检出越多"),
      silenceDb: z.number().optional().describe("静音判定电平 dB，默认 -30"),
      silenceMinSec: z.number().optional().describe("静音最短时长（秒），默认 0.5"),
    },
  },
  async ({ path, sceneThreshold, silenceDb, silenceMinSec }) => {
    const result = await analyzeMedia(path, {
      ...(sceneThreshold !== undefined ? { sceneThreshold } : {}),
      ...(silenceDb !== undefined ? { silenceDb } : {}),
      ...(silenceMinSec !== undefined ? { silenceMinSec } : {}),
    });
    return jsonResult(result, result.ok);
  },
);

tool(
  "plan_render",
  {
    description: "dry-run：输出渲染计划（FFmpeg 参数、filtergraph、成片总时长），不实际渲染。渲染前可先审计划。",
    inputSchema: { jobPath: z.string().describe("DSL 任务 JSON 文件路径") },
  },
  async ({ jobPath }) => {
    const result = await planJob(jobPath);
    return jsonResult(result, result.ok);
  },
);

tool(
  "render_video",
  {
    description: "渲染 DSL 任务并导出 MP4 到 export.output 指定路径。返回产物路径、时长、文件大小、耗时。",
    inputSchema: { jobPath: z.string().describe("DSL 任务 JSON 文件路径") },
  },
  async ({ jobPath }) => {
    const result = await renderJob(jobPath);
    return jsonResult(result, result.ok);
  },
);

tool(
  "extract_frame",
  {
    description:
      "抽取成片任意时间点的单帧 PNG（按 DSL 编译后的最终画面，含文字/字幕）。渲染前后用它做视觉检查：字幕位置、文字溢出、画面构图。",
    inputSchema: {
      jobPath: z.string().describe("DSL 任务 JSON 文件路径"),
      atSec: z.number().min(0).describe("时间点（秒），须小于成片总时长"),
      outPng: z.string().describe("输出 PNG 路径"),
    },
  },
  async ({ jobPath, atSec, outPng }) => {
    const result = await extractFrame(jobPath, atSec, outPng);
    return jsonResult(result, result.ok);
  },
);

tool(
  "contact_sheet",
  {
    description:
      "生成九宫格缩略图（每格左上角带时间戳），一张图看全片节奏。target 传 DSL job.json 看成片效果，传媒体文件路径看原素材。",
    inputSchema: {
      target: z.string().describe("DSL job.json 路径或媒体文件路径"),
      outPng: z.string().describe("输出 PNG 路径"),
      cols: z.number().int().min(1).max(10).optional().describe("列数，默认 3"),
      rows: z.number().int().min(1).max(10).optional().describe("行数，默认 3"),
    },
  },
  async ({ target, outPng, cols, rows }) => {
    const result = await contactSheet(target, outPng, {
      ...(cols !== undefined ? { cols } : {}),
      ...(rows !== undefined ? { rows } : {}),
    });
    return jsonResult(result, result.ok);
  },
);

tool(
  "patch_dsl",
  {
    description:
      "对 DSL 任务文件应用 JSON Patch（add/remove/replace/test）增量修改，校验通过才落盘；失败返回 issues 且不写文件。改单个字段时优先用本工具而不是重写整份 JSON。",
    inputSchema: {
      jobPath: z.string().describe("DSL 任务 JSON 文件路径"),
      ops: z
        .array(
          z.object({
            op: z.enum(["add", "remove", "replace", "test"]),
            path: z.string().describe("JSON Pointer，如 /tracks/0/clips/1/out；数组追加用 /-"),
            value: z.unknown().optional(),
          }),
        )
        .describe("JSON Patch 操作数组"),
      dryRun: z.boolean().optional().describe("只预览结果不写文件"),
    },
  },
  async ({ jobPath, ops, dryRun }) => {
    const result = await patchJobFile(jobPath, ops as any, { dryRun: dryRun ?? false });
    return jsonResult(result, result.ok);
  },
);

tool(
  "transcribe_media",
  {
    description:
      "whisper.cpp 本地语音转写，输出带时间戳的 segments。可顺带写出 SRT 字幕文件直接挂进 DSL 的 subtitle 轨。按文稿剪辑工作流：转写 → 决定保留哪些 segments → 用其 startSec/endSec 写 video 轨 clips 的 in/out。",
    inputSchema: {
      path: z.string().describe("媒体文件本地路径（需有音频轨）"),
      model: z.string().optional().describe("模型名（base/small/medium/large-v3-turbo）或模型文件路径，默认 base"),
      language: z.string().optional().describe("语言代码（zh/en/...），默认 auto；中文会自动加简体提示词"),
      outSrt: z.string().optional().describe("可选：SRT 字幕输出路径"),
    },
  },
  async ({ path, model, language, outSrt }) => {
    const result = await transcribeMedia(path, {
      ...(model !== undefined ? { model } : {}),
      ...(language !== undefined ? { language } : {}),
      ...(outSrt !== undefined ? { outSrt } : {}),
    });
    return jsonResult(result, result.ok);
  },
);

await server.connect(new StdioServerTransport());
