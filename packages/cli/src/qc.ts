#!/usr/bin/env bun
/**
 * qc — 晴辰剪辑 CLI。AI 优先：所有输出均为 JSON（stdout），退出码
 * 0 = 成功，1 = 校验/任务失败（输出含 issues），2 = 用法或内部错误。
 */
import { getJobJsonSchema } from "@qingchen/cut-dsl";
import {
  extractFrame,
  planJob,
  probeMedia,
  renderJob,
  runDoctor,
  validateJobFile,
} from "@qingchen/cut-core";

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
