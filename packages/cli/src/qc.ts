#!/usr/bin/env bun
/**
 * qc — 晴辰剪辑 CLI。AI 优先：所有输出均为 JSON（stdout），退出码
 * 0 = 成功，1 = 校验/任务失败（输出含 issues），2 = 用法或内部错误。
 */
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
  validateJobFile,
} from "@qingchen/cut-core";
import { readFileSync } from "node:fs";

const HELP = `qc <command> [args]

命令:
  doctor                     环境诊断（FFmpeg、滤镜、中文字体）
  schema                     输出 Editing DSL 的 JSON Schema（AI 写 DSL 前先读这个）
  validate <job.json>        校验 DSL：schema + 语义 + 文件存在性 + 素材深度校验
      --skip-probe           跳过 ffprobe 深度校验（更快）
  plan <job.json>            dry-run：输出将执行的 FFmpeg 命令与 filtergraph，不渲染
  render <job.json>          渲染导出 MP4；进度以 NDJSON 逐行输出
      --keep-temp            渲染后保留临时目录（filtergraph/文本文件）
  frame <job.json> --at <秒> --out <png>
                             抽取成片任意时间点单帧，供 AI 视觉复核
  probe <media>              读取媒体元数据（时长/分辨率/帧率/旋转/音轨）
  analyze <media>            素材分析：场景切换点 / 静音段 / 响度（粗剪决策依据）
      --scene <0~1>          场景灵敏度阈值，默认 0.3
      --silence-db <dB>      静音判定电平，默认 -30
      --silence-min <秒>     静音最短时长，默认 0.5
  contact-sheet <media|job.json> --out <png>
                             九宫格缩略图（每格带时间戳），一张图看全片节奏
      --cols <n> --rows <n>  网格尺寸，默认 3x3
  patch <job.json> --ops <ops.json>
                             JSON Patch 增量修改 DSL（add/remove/replace/test），校验通过才落盘
      --dry-run              只预览结果不写文件
  help                       显示本帮助

输出: 全部为 JSON（render 为 NDJSON）。退出码: 0 成功 / 1 任务失败 / 2 用法或内部错误。`;

function flagValue(rest: string[], name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

function out(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const args = rest.filter((a) => !a.startsWith("--"));

  switch (cmd) {
    case "doctor": {
      const report = await runDoctor();
      out(report);
      return report.ok ? 0 : 1;
    }
    case "schema": {
      out(getJobJsonSchema());
      return 0;
    }
    case "validate": {
      const jobPath = args[0];
      if (!jobPath) {
        out({ ok: false, error: "用法: qc validate <job.json>" });
        return 2;
      }
      const result = await validateJobFile(jobPath, { skipProbe: flags.has("--skip-probe") });
      out(result);
      return result.ok ? 0 : 1;
    }
    case "plan": {
      const jobPath = args[0];
      if (!jobPath) {
        out({ ok: false, error: "用法: qc plan <job.json>" });
        return 2;
      }
      const result = await planJob(jobPath);
      out(result);
      return result.ok ? 0 : 1;
    }
    case "render": {
      const jobPath = args[0];
      if (!jobPath) {
        out({ ok: false, error: "用法: qc render <job.json>" });
        return 2;
      }
      const result = await renderJob(jobPath, {
        keepTemp: flags.has("--keep-temp"),
        onProgress: (p) => console.log(JSON.stringify(p)), // NDJSON 进度
      });
      console.log(JSON.stringify({ stage: "done", ...result }));
      return result.ok ? 0 : 1;
    }
    case "frame": {
      const jobPath = args[0];
      const at = flagValue(rest, "--at");
      const outPng = flagValue(rest, "--out");
      if (!jobPath || at === undefined || !outPng) {
        out({ ok: false, error: "用法: qc frame <job.json> --at <秒> --out <png>" });
        return 2;
      }
      const result = await extractFrame(jobPath, Number(at), outPng);
      out(result);
      return result.ok ? 0 : 1;
    }
    case "probe": {
      const mediaPath = args[0];
      if (!mediaPath) {
        out({ ok: false, error: "用法: qc probe <media>" });
        return 2;
      }
      const result = await probeMedia(mediaPath);
      out({ ok: result.issues.length === 0, ...result });
      return result.issues.length === 0 ? 0 : 1;
    }
    case "analyze": {
      const mediaPath = args[0];
      if (!mediaPath) {
        out({ ok: false, error: "用法: qc analyze <media>" });
        return 2;
      }
      const scene = flagValue(rest, "--scene");
      const silenceDb = flagValue(rest, "--silence-db");
      const silenceMin = flagValue(rest, "--silence-min");
      const result = await analyzeMedia(mediaPath, {
        ...(scene !== undefined ? { sceneThreshold: Number(scene) } : {}),
        ...(silenceDb !== undefined ? { silenceDb: Number(silenceDb) } : {}),
        ...(silenceMin !== undefined ? { silenceMinSec: Number(silenceMin) } : {}),
      });
      out(result);
      return result.ok ? 0 : 1;
    }
    case "contact-sheet": {
      const target = args[0];
      const outPng = flagValue(rest, "--out");
      if (!target || !outPng) {
        out({ ok: false, error: "用法: qc contact-sheet <media|job.json> --out <png>" });
        return 2;
      }
      const cols = flagValue(rest, "--cols");
      const rows = flagValue(rest, "--rows");
      const result = await contactSheet(target, outPng, {
        ...(cols !== undefined ? { cols: Number(cols) } : {}),
        ...(rows !== undefined ? { rows: Number(rows) } : {}),
      });
      out(result);
      return result.ok ? 0 : 1;
    }
    case "patch": {
      const jobPath = args[0];
      const opsPath = flagValue(rest, "--ops");
      if (!jobPath || !opsPath) {
        out({ ok: false, error: "用法: qc patch <job.json> --ops <ops.json> [--dry-run]" });
        return 2;
      }
      let ops: unknown;
      try {
        ops = JSON.parse(readFileSync(opsPath, "utf8"));
      } catch (e) {
        out({ ok: false, error: `ops 文件读取/解析失败: ${(e as Error).message}` });
        return 2;
      }
      if (!Array.isArray(ops)) {
        out({ ok: false, error: "ops 文件必须是 JSON Patch 操作数组" });
        return 2;
      }
      const result = await patchJobFile(jobPath, ops as any, { dryRun: flags.has("--dry-run") });
      out(result);
      return result.ok ? 0 : 1;
    }
    case "help":
    case "--help":
    case "-h":
    case undefined: {
      console.log(HELP);
      return cmd ? 0 : 2;
    }
    default: {
      out({ ok: false, error: `未知命令: ${cmd}`, suggestion: "运行 qc help 查看可用命令" });
      return 2;
    }
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    console.log(JSON.stringify({ ok: false, error: String(e?.stack ?? e) }, null, 2));
    process.exit(2);
  });
