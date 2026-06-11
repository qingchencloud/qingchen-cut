import { z } from "zod";

/**
 * Editing DSL v1 schema。
 * 约定：
 * - 时间一律为秒（浮点）。
 * - 位置坐标为 0~1 归一化值，相对画布。
 * - 素材路径可为绝对路径，或相对于 job 文件所在目录的相对路径。
 * - 字段 description 即面向 AI 的 API 文档，会随 JSON Schema 一起导出。
 */

const timeSec = z.number().min(0).describe("时间，单位秒（浮点）");

export const canvasSchema = z
  .object({
    width: z.number().int().min(16).max(7680).describe("画布宽度（像素）"),
    height: z.number().int().min(16).max(7680).describe("画布高度（像素）"),
  })
  .describe("成片画布尺寸，常用 1920x1080（横屏）/ 1080x1920（竖屏）");

export const projectSchema = z.object({
  name: z.string().min(1).describe("项目名，仅用于日志与产物命名"),
  canvas: canvasSchema,
  fps: z.number().min(1).max(120).default(30).describe("成片帧率"),
  background: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#000000")
    .describe("画布背景色，十六进制 #RRGGBB"),
});

export const assetSchema = z.object({
  id: z.string().min(1).describe("素材引用 ID，时间线 clip 通过 assetId 引用"),
  path: z
    .string()
    .min(1)
    .describe("本地素材路径；绝对路径或相对于 job 文件所在目录"),
});

export const transitionSchema = z
  .object({
    type: z.enum(["fade"]).describe("转场类型，v1 仅支持 fade（交叉淡化）"),
    duration: z
      .number()
      .positive()
      .max(5)
      .describe(
        "转场时长（秒）。语义：与下一个 clip 重叠该时长，成片总时长会相应缩短；必须 ≤ 相邻两个 clip 可见时长较小者的一半",
      ),
  })
  .describe("挂在前一个 clip 上的出场转场");

export const positionSchema = z
  .object({
    x: z.number().min(0).max(1).default(0.5).describe("水平位置，0=左 1=右"),
    y: z.number().min(0).max(1).default(0.5).describe("垂直位置，0=上 1=下"),
    anchor: z
      .enum(["center", "top", "bottom", "left", "right"])
      .default("center")
      .describe("锚点：文本以该点对齐到 (x, y)"),
  })
  .describe("归一化位置，相对画布，与分辨率无关");

export const textStyleSchema = z.object({
  fontFamily: z
    .string()
    .default("Microsoft YaHei")
    .describe("字体名，需为本机已安装字体；中文推荐 Microsoft YaHei"),
  fontSize: z.number().int().min(8).max(500).default(64).describe("字号（像素，相对画布）"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#ffffff")
    .describe("文字颜色 #RRGGBB"),
  stroke: z
    .object({
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000"),
      width: z.number().min(0).max(20).default(2),
    })
    .optional()
    .describe("描边，提高文字在复杂画面上的可读性"),
  position: positionSchema.default({ x: 0.5, y: 0.5, anchor: "center" }),
});

export const videoClipSchema = z
  .object({
    assetId: z.string().describe("引用 assets[].id"),
    in: timeSec.describe("从素材的该时间点开始取（秒）"),
    out: timeSec.describe("取到素材的该时间点为止（秒），必须大于 in"),
    speed: z
      .number()
      .min(0.25)
      .max(4)
      .default(1)
      .describe("变速倍率，2 = 二倍速；可见时长 = (out - in) / speed"),
    volume: z.number().min(0).max(2).default(1).describe("该片段音量，0 = 静音"),
    fit: z
      .enum(["contain", "cover", "stretch"])
      .default("contain")
      .describe("素材与画布比例不一致时的适配：contain 加黑边 / cover 裁切 / stretch 拉伸"),
    transitionOut: transitionSchema.optional(),
  })
  .describe(
    "视频片段。同一轨道内按数组顺序首尾相接，不需要也不允许指定时间线位置；顺序即剪辑顺序",
  );

export const textClipSchema = z.object({
  text: z.string().min(1).describe("显示的文字，支持 \\n 换行"),
  start: timeSec.describe("在成片时间线上的出现时刻（秒）"),
  duration: z.number().positive().describe("持续时长（秒）"),
  // prefault: 缺省时把 {} 交给 schema 解析，从而填充各字段默认值
  style: textStyleSchema.prefault({}).describe("文字样式"),
});

export const audioClipSchema = z
  .object({
    assetId: z.string().describe("引用 assets[].id"),
    start: timeSec.describe("在成片时间线上的起始时刻（秒）"),
    in: timeSec.default(0).describe("从素材的该时间点开始取（秒）"),
    duration: z
      .union([z.number().positive(), z.literal("auto")])
      .default("auto")
      .describe('持续时长（秒）；"auto" = 播到素材结尾或成片结尾（取先到者）'),
    volume: z.number().min(0).max(2).default(1),
    fadeIn: z.number().min(0).max(30).default(0).describe("淡入时长（秒）"),
    fadeOut: z.number().min(0).max(30).default(0).describe("淡出时长（秒）"),
  })
  .describe("音频片段（配乐/音效），叠加在视频自带音频之上");

export const videoTrackSchema = z.object({
  id: z.string().min(1),
  type: z.literal("video"),
  clips: z.array(videoClipSchema).min(1),
});

export const textTrackSchema = z.object({
  id: z.string().min(1),
  type: z.literal("text"),
  clips: z.array(textClipSchema).min(1),
});

export const subtitleTrackSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("subtitle"),
    source: z
      .union([
        z.object({ srt: z.string().min(1).describe("SRT 字幕文件路径") }),
        z.object({ ass: z.string().min(1).describe("ASS 字幕文件路径") }),
      ])
      .describe("外部字幕文件，路径规则同素材路径"),
    style: z
      .object({
        preset: z
          .enum(["default-bottom"])
          .default("default-bottom")
          .describe("字幕样式预设；仅对 SRT 生效，ASS 使用文件内样式"),
      })
      .default({ preset: "default-bottom" }),
  })
  .describe("字幕轨，整轨从字幕文件加载");

export const audioTrackSchema = z.object({
  id: z.string().min(1),
  type: z.literal("audio"),
  clips: z.array(audioClipSchema).min(1),
});

export const trackSchema = z.discriminatedUnion("type", [
  videoTrackSchema,
  textTrackSchema,
  subtitleTrackSchema,
  audioTrackSchema,
]);

export const exportSchema = z.object({
  format: z.literal("mp4").default("mp4"),
  video: z
    .object({
      codec: z.literal("h264").default("h264"),
      crf: z
        .number()
        .int()
        .min(0)
        .max(51)
        .default(18)
        .describe("质量因子，越小越清晰体积越大；18 ≈ 视觉无损，23 = 默认均衡"),
      preset: z
        .enum(["ultrafast", "fast", "medium", "slow"])
        .default("medium")
        .describe("编码速度/压缩率权衡"),
    })
    .default({ codec: "h264", crf: 18, preset: "medium" }),
  audio: z
    .object({
      codec: z.literal("aac").default("aac"),
      bitrate: z
        .string()
        .regex(/^\d+k$/)
        .default("192k"),
    })
    .default({ codec: "aac", bitrate: "192k" }),
  output: z
    .string()
    .min(1)
    .describe("成片输出路径，必须以 .mp4 结尾；绝对路径或相对于 job 文件所在目录"),
});

export const jobSchema = z
  .object({
    version: z.literal(1).describe("DSL 版本号"),
    project: projectSchema,
    assets: z.array(assetSchema).default([]),
    tracks: z.array(trackSchema).min(1),
    export: exportSchema,
  })
  .describe("晴辰剪辑 Editing DSL v1：一份完整、可复现的剪辑任务");

export type Canvas = z.infer<typeof canvasSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Transition = z.infer<typeof transitionSchema>;
export type TextStyle = z.infer<typeof textStyleSchema>;
export type VideoClip = z.infer<typeof videoClipSchema>;
export type TextClip = z.infer<typeof textClipSchema>;
export type AudioClip = z.infer<typeof audioClipSchema>;
export type VideoTrack = z.infer<typeof videoTrackSchema>;
export type TextTrack = z.infer<typeof textTrackSchema>;
export type SubtitleTrack = z.infer<typeof subtitleTrackSchema>;
export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type Track = z.infer<typeof trackSchema>;
export type ExportSettings = z.infer<typeof exportSchema>;
export type Job = z.infer<typeof jobSchema>;
