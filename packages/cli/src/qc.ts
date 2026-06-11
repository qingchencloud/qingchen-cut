#!/usr/bin/env bun
/**
 * qc — 晴辰剪辑 CLI。AI 优先：所有输出均为 JSON（stdout），退出码
 * 0 = 成功，1 = 校验/任务失败（输出含 issues），2 = 用法或内部错误。
 */
import { getJobJsonSchema } from "@qingchen/cut-dsl";
import {
  analyzeMedia,
  contactSheet,
  createNarratedJobFile,
  extractFrame,
  patchJobFile,
  planJob,
  probeMedia,
  parseNarrationScript,
  renderBatch,
  renderJob,
  renderTemplate,
  runDoctor,
  synthesizeNarration,
  synthesizeSpeech,
  transcribeMedia,
  validateJobFile,
} from "@qingchen/cut-core";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

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
  template <template.json> --vars <vars.json> [--out <job.json>]
                             实例化 DSL 模板（\${变量} 占位符），校验通过才落盘
  batch <job.json...>        顺序批量渲染，NDJSON 逐任务进度 + 汇总
  transcribe <media>         whisper.cpp 本地语音转写 → 带时间戳的 segments JSON
      --model <名|路径>      模型，默认 base（更佳中文效果用 large-v3-turbo）
      --lang <代码>          语言（zh/en/...），默认 auto
      --srt <路径>           顺带写出 SRT 字幕文件
  tts --text <文案> --out <wav>
                             Windows SAPI 本地 TTS：文本 → WAV，返回真实音频时长
      --text-file <txt>      从文本文件读取文案（与 --text 二选一）
      --voice <名称>         指定 SAPI 音色；默认优先中文音色
      --rate <-10..10>       语速，默认 0
      --volume <0..100>      音量，默认 100
  narrate --script <txt|json> --video <mp4> --out-dir <dir> --out-job <job.json> --out <mp4>
                             文案分段 TTS → WAV/SRT → 音画同步 DSL（渲染再用 qc render）
      --bgm <audio>          可选 BGM
      --title <文案>         可选标题；JSON script.title 也可提供
      --base-name <name>     产物基础文件名，默认 narration
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
    case "template": {
      const templatePath = args[0];
      const varsPath = flagValue(rest, "--vars");
      if (!templatePath || !varsPath) {
        out({ ok: false, error: "用法: qc template <template.json> --vars <vars.json> [--out <job.json>]" });
        return 2;
      }
      let vars: unknown;
      try {
        vars = JSON.parse(readFileSync(varsPath, "utf8"));
      } catch (e) {
        out({ ok: false, error: `vars 文件读取/解析失败: ${(e as Error).message}` });
        return 2;
      }
      if (vars === null || typeof vars !== "object" || Array.isArray(vars)) {
        out({ ok: false, error: "vars 文件必须是 JSON 对象（变量名 → 值）" });
        return 2;
      }
      const result = renderTemplate(templatePath, vars as Record<string, unknown>, flagValue(rest, "--out"));
      out(result);
      return result.ok ? 0 : 1;
    }
    case "batch": {
      if (args.length === 0) {
        out({ ok: false, error: "用法: qc batch <job.json> [job2.json ...]" });
        return 2;
      }
      const result = await renderBatch(args, {
        onJobStart: (jobPath, index, total) =>
          console.log(JSON.stringify({ stage: "job-start", jobPath, index: index + 1, total })),
        onJobDone: (r) =>
          console.log(JSON.stringify({ stage: "job-done", jobPath: r.jobPath, ok: r.ok, output: r.output })),
      });
      console.log(JSON.stringify({ stage: "batch-done", ...result }, null, 2));
      return result.ok ? 0 : 1;
    }
    case "transcribe": {
      const mediaPath = args[0];
      if (!mediaPath) {
        out({ ok: false, error: "用法: qc transcribe <media> [--model 名] [--lang zh] [--srt out.srt]" });
        return 2;
      }
      const model = flagValue(rest, "--model");
      const lang = flagValue(rest, "--lang");
      const srt = flagValue(rest, "--srt");
      const result = await transcribeMedia(mediaPath, {
        ...(model !== undefined ? { model } : {}),
        ...(lang !== undefined ? { language: lang } : {}),
        ...(srt !== undefined ? { outSrt: srt } : {}),
      });
      out(result);
      return result.ok ? 0 : 1;
    }
    case "tts": {
      const textFile = flagValue(rest, "--text-file");
      const text = flagValue(rest, "--text") ?? (textFile ? readFileSync(textFile, "utf8") : undefined);
      const outWav = flagValue(rest, "--out");
      if (!text || !outWav) {
        out({ ok: false, error: "用法: qc tts --text <文案> --out <wav> 或 qc tts --text-file <txt> --out <wav>" });
        return 2;
      }
      const rate = flagValue(rest, "--rate");
      const volume = flagValue(rest, "--volume");
      const result = await synthesizeSpeech({
        text,
        outWav,
        ...(flagValue(rest, "--voice") ? { voice: flagValue(rest, "--voice") } : {}),
        ...(rate !== undefined ? { rate: Number(rate) } : {}),
        ...(volume !== undefined ? { volume: Number(volume) } : {}),
      });
      out(result);
      return result.ok ? 0 : 1;
    }
    case "narrate": {
      const scriptPath = flagValue(rest, "--script");
      const videoPath = flagValue(rest, "--video");
      const outJob = flagValue(rest, "--out-job");
      const outputPath = flagValue(rest, "--out");
      if (!scriptPath || !videoPath || !outJob || !outputPath) {
        out({
          ok: false,
          error:
            "用法: qc narrate --script <txt|json> --video <mp4> --out-dir <dir> --out-job <job.json> --out <mp4> [--bgm <audio>] [--title <文案>]",
        });
        return 2;
      }
      const parsed = parseNarrationScript(readFileSync(scriptPath, "utf8"));
      if (!parsed.ok || !parsed.segments) {
        out(parsed);
        return 1;
      }
      const rate = flagValue(rest, "--rate");
      const volume = flagValue(rest, "--volume");
      const outDir = flagValue(rest, "--out-dir") ?? dirname(outJob);
      const narration = await synthesizeNarration({
        segments: parsed.segments,
        outDir,
        baseName: flagValue(rest, "--base-name") ?? "narration",
        ...(flagValue(rest, "--voice") ? { voice: flagValue(rest, "--voice") } : {}),
        ...(rate !== undefined ? { rate: Number(rate) } : {}),
        ...(volume !== undefined ? { volume: Number(volume) } : {}),
      });
      if (!narration.ok) {
        out({ ok: false, narration, issues: narration.issues });
        return 1;
      }
      const job = await createNarratedJobFile({
        narration,
        videoPath,
        ...(flagValue(rest, "--bgm") ? { bgmPath: flagValue(rest, "--bgm") } : {}),
        jobPath: outJob,
        outputPath,
        title: flagValue(rest, "--title") ?? parsed.title,
      });
      out({ ok: job.ok, title: flagValue(rest, "--title") ?? parsed.title, narration, job, issues: job.issues });
      return job.ok ? 0 : 1;
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
