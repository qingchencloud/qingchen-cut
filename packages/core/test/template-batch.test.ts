import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { makeFixtures } from "../../../script/make-fixtures";
import { renderBatch, renderTemplate, resolveTool, validateJobFile } from "../src/index";

const fixturesDir = join(import.meta.dir, "..", "..", "..", "fixtures");
const templatePath = join(fixturesDir, "jobs", "template-vertical.json");
const hasFFmpeg = resolveTool("ffmpeg") !== null && resolveTool("ffprobe") !== null;

beforeAll(async () => {
  if (hasFFmpeg) await makeFixtures();
});

const vars = (over: Record<string, unknown> = {}) => ({
  name: "demo-a",
  videoPath: join(fixturesDir, "media", "测试 红色.mp4"),
  in: 0,
  out: 2,
  title: "标题：第1期",
  outputPath: join(fixturesDir, "out", "tpl-a.mp4"),
  ...over,
});

describe("template 实例化", () => {
  test("整值占位符保留类型、内嵌占位符拼接、变量清单返回", () => {
    const r = renderTemplate(templatePath, vars());
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.ok).toBe(true);
    const job = r.job as any;
    expect(job.tracks[0].clips[0].in).toBe(0); // number，不是 "0"
    expect(job.tracks[1].clips[0].text).toBe("标题：第1期");
    expect(r.variables!.sort()).toEqual(["in", "name", "out", "outputPath", "title", "videoPath"]);
  });

  test("缺变量 → TEMPLATE_MISSING_VARS 列出缺失项", () => {
    const { title, ...rest } = vars();
    const r = renderTemplate(templatePath, rest);
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.code).toBe("TEMPLATE_MISSING_VARS");
    expect(r.issues[0]!.message).toContain("title");
  });

  test("实例化结果非法 → 不落盘并返回 DSL 校验错误", () => {
    const outJob = join(fixturesDir, "out", "__tpl-bad.json");
    rmSync(outJob, { force: true });
    const r = renderTemplate(templatePath, vars({ in: 5, out: 2 }), outJob);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "DSL_TIME_RANGE")).toBe(true);
    expect(existsSync(outJob)).toBe(false);
  });
});

describe.if(hasFFmpeg)("template → batch 端到端", () => {
  test(
    "同模板两组变量 → 批量出两条片",
    async () => {
      const jobA = join(fixturesDir, "out", "tpl-a.json");
      const jobB = join(fixturesDir, "out", "tpl-b.json");
      const ra = renderTemplate(templatePath, vars(), jobA);
      const rb = renderTemplate(
        templatePath,
        vars({
          name: "demo-b",
          videoPath: join(fixturesDir, "media", "test-blue.mp4"),
          title: "标题：第2期",
          out: 3,
          outputPath: join(fixturesDir, "out", "tpl-b.mp4"),
        }),
        jobB,
      );
      expect(ra.ok && rb.ok).toBe(true);

      const events: string[] = [];
      const batch = await renderBatch([jobA, jobB], {
        onJobStart: (p) => events.push(`start:${p}`),
        onJobDone: (r) => events.push(`done:${r.ok}`),
      });
      expect(batch.ok).toBe(true);
      expect(batch.total).toBe(2);
      expect(batch.succeeded).toBe(2);
      expect(events).toHaveLength(4);
      const va = await validateJobFile(jobA);
      expect(existsSync(join(fixturesDir, "out", "tpl-a.mp4"))).toBe(true);
      expect(existsSync(join(fixturesDir, "out", "tpl-b.mp4"))).toBe(true);
      expect(va.ok).toBe(true);
    },
    600_000,
  );

  test("批量中单个失败不中断，汇总 failed 计数", async () => {
    const missing = join(fixturesDir, "jobs", "不存在.json");
    const jobA = join(fixturesDir, "out", "tpl-a.json");
    const batch = await renderBatch([missing, jobA]);
    expect(batch.ok).toBe(false);
    expect(batch.total).toBe(2);
    expect(batch.failed).toBe(1);
    expect(batch.jobs[0]!.issues[0]!.code).toBe("FS_JOB_NOT_FOUND");
  }, 600_000);
});
