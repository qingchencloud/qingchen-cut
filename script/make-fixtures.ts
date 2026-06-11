#!/usr/bin/env bun
/**
 * 生成测试素材到 fixtures/media/（gitignore，不入库）。
 * 故意使用中文+空格文件名，把 Windows 路径问题当作一等测试对象。
 * 用法: bun script/make-fixtures.ts [--force]
 */
import { resolveTool, run } from "../packages/core/src/ffmpeg";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const mediaDir = join(import.meta.dir, "..", "fixtures", "media");
const force = process.argv.includes("--force");

interface Fixture {
  file: string;
  args: (out: string) => string[];
}

const FIXTURES: Fixture[] = [
  {
    // 5 秒红色测试卡 + 440Hz 音调，640x360
    file: "测试 红色.mp4",
    args: (out) => [
      "-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=5",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out,
    ],
  },
  {
    // 4 秒蓝色测试卡 + 880Hz 音调，1280x720（与画布比例不一致，测 fit）
    file: "test-blue.mp4",
    args: (out) => [
      "-f", "lavfi", "-i", "color=c=blue:s=1280x720:r=30:d=4",
      "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100:duration=4",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out,
    ],
  },
  {
    // 4 秒：前 2 秒红后 2 秒蓝（1 个场景切换），1.5~2.5s 静音（1 个静音段）
    file: "scene-cut.mp4",
    args: (out) => [
      "-f", "lavfi", "-i", "color=c=red:s=320x180:r=30:d=2",
      "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=2",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=4",
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a]volume='if(between(t,1.5,2.5),0,1)':eval=frame[a]",
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", out,
    ],
  },
  {
    // 10 秒双音 BGM
    file: "bgm.mp3",
    args: (out) => [
      "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100:duration=10",
      "-c:a", "libmp3lame", "-b:a", "128k", out,
    ],
  },
];

/** Windows SAPI TTS 生成中文语音素材（转写测试用）；非 Windows 或无中文音色时跳过 */
function makeSpeechFixture(): string | null {
  if (process.platform !== "win32") return null;
  const out = join(mediaDir, "语音 测试.wav");
  if (existsSync(out) && !force) return null;
  const ps = [
    "Add-Type -AssemblyName System.Speech;",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    "$zh = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name } | Where-Object { $_ -match 'Huihui|Kangkang|Yaoyao' } | Select-Object -First 1;",
    "if ($zh) { $s.SelectVoice($zh) };",
    `$s.SetOutputToWaveFile('${out.replace(/'/g, "''")}');`,
    "$s.Speak('晴辰剪辑是一个人工智能视频剪辑工具。今天天气很好。');",
    "$s.Dispose();",
  ].join(" ");
  const r = require("node:child_process").spawnSync("powershell", ["-NoProfile", "-Command", ps], {
    windowsHide: true,
    timeout: 60_000,
  });
  return r.status === 0 && existsSync(out) ? out : null;
}

export async function makeFixtures(): Promise<string[]> {
  const ffmpeg = resolveTool("ffmpeg");
  if (!ffmpeg) throw new Error("找不到 ffmpeg，先运行 qc doctor 检查环境");
  mkdirSync(mediaDir, { recursive: true });
  mkdirSync(join(import.meta.dir, "..", "fixtures", "out"), { recursive: true });

  const made: string[] = [];
  for (const f of FIXTURES) {
    const out = join(mediaDir, f.file);
    if (existsSync(out) && !force) continue;
    const result = await run(ffmpeg.path, ["-y", ...f.args(out)], { timeoutMs: 60_000 });
    if (result.code !== 0) {
      throw new Error(`生成 ${f.file} 失败:\n${result.stderr.slice(-800)}`);
    }
    made.push(out);
  }
  const speech = makeSpeechFixture();
  if (speech) made.push(speech);
  return made;
}

if (import.meta.main) {
  const made = await makeFixtures();
  console.log(JSON.stringify({ ok: true, generated: made, dir: mediaDir }, null, 2));
}
