# AI Agent 自动剪辑路线

## 状态（2026-06-11）

- ✅ **P0 全部达成**：DSL schema（`packages/dsl`）、headless core（`packages/core`）、`qc` CLI（doctor/schema/validate/probe/plan/render/frame）、MP4 导出，全程零人工点击。
- ✅ **P1 大部分达成**：音量、变速、fade 转场、画布比例（contain/cover/stretch）、DSL 回放（golden 测试）、结构化错误（code/stage/path/suggestion）。封面截图由 `qc frame` 覆盖。
- ✅ **P2 部分达成**：MCP server（10 工具）、`qc analyze`（场景/静音/响度）、`qc contact-sheet`、`qc patch` 增量修改、渲染 NDJSON 进度。
- ⏳ 进行中：whisper 本地转写、按文稿剪辑、批量队列、模板化生成。

## 目标

晴辰剪辑的主目标是让 AI 直接完成视频剪辑任务，不依赖人工打开界面逐步操作。理想输入是一段自然语言需求或结构化 JSON，理想输出是本地 MP4 文件和可复现的剪辑工程。

明确边界：AI 主执行链路不依赖浏览器操作，不把 Playwright/Chromium 当成剪辑控制面。Web UI 只作为预览、调试和人工复核入口。

## 成功标准

P0 成功标准：

- AI 能从本地路径导入 1 个或多个视频素材。
- AI 能创建项目并生成可保存的时间线。
- AI 能完成裁切、拼接、添加标题文字或字幕。
- AI 能导出 MP4 到指定路径。
- 整个流程可由命令行或 MCP 工具触发，不需要人工点击。

P1 成功标准：

- 支持音量、静音、变速、基础转场、画布比例、封面截图。
- 支持从 JSON DSL 回放同一个剪辑任务。
- 失败时输出结构化错误，包含阶段、原因和建议修复动作。

P2 成功标准：

- 批量任务队列。
- 模板化短视频生成。
- 自动字幕和智能粗剪接入。
- 渲染过程可观测，可恢复或重试。

## 架构草案

### Editing DSL

用 JSON 表达剪辑计划。第一版只覆盖确定性剪辑：

```json
{
  "project": {
    "name": "demo",
    "canvas": { "width": 1920, "height": 1080 },
    "fps": 30
  },
  "assets": [
    { "id": "a", "path": "D:/clips/a.mp4" }
  ],
  "timeline": [
    { "type": "video", "assetId": "a", "start": 0, "in": 2, "out": 8 },
    { "type": "text", "text": "晴辰剪辑", "start": 0, "duration": 2 }
  ],
  "export": {
    "format": "mp4",
    "quality": "high",
    "output": "D:/exports/demo.mp4"
  }
}
```

### 控制边界

不做浏览器内 Agent Bridge 作为主路径。OpenCut Classic 的 Web 编辑器可保留，但 AI 自动剪辑应直接调用 headless core、CLI 或 MCP 工具。

### Headless Core

无浏览器剪辑内核负责：

- 解析和校验 Editing DSL。
- 使用 `ffprobe` 或等价能力读取本地媒体元数据。
- 将 DSL 编译成可执行时间线。
- 调用渲染后端生成本地 MP4。
- 输出结构化结果、错误和诊断信息。

P0 渲染后端优先使用本地 FFmpeg/FFprobe 或等价 native 能力。OpenCut Web 现有 Canvas/WebCodecs 导出可作为参考，不作为 AI 主链路依赖。

### CLI

CLI 是第一优先级执行入口：

- `qingchen-cut validate job.json`
- `qingchen-cut probe D:/clips/a.mp4`
- `qingchen-cut render job.json --output D:/exports/demo.mp4`
- `qingchen-cut inspect-project project.json`

CLI 负责文件系统访问、渲染进程管理、输出落盘、日志和退出码。AI 可以直接调用 CLI，也可以通过 MCP 间接调用。

### MCP Server

等 CLI/Core 稳定后再封装 MCP。MCP 不直接承载剪辑逻辑，只作为工具协议层：

- `create_video_from_dsl`
- `render_video`
- `probe_media`
- `inspect_project`
- `validate_dsl`

## P0 实施顺序

1. 定义 Editing DSL schema 和 fixture。
2. 增加 CLI 骨架：`validate`、`probe`、`render`。
3. 接入本地媒体探测能力，读取时长、分辨率、帧率、音频轨。
4. 实现 DSL 到 FFmpeg/native 渲染计划的编译。
5. 支持单轨视频裁切、拼接、标题文字或字幕。
6. 支持 MP4 导出到指定路径。
7. 增加 smoke test：输入一段短视频，输出一个 5 秒带标题 MP4。
8. CLI 稳定后封装 MCP server，让 AI 通过工具调用触发同一套能力。

## 风险

- OpenCut Classic 已归档，上游不会修复导出和浏览器兼容问题。
- 现有导出依赖浏览器、Canvas、WebCodecs 和 OPFS，不能直接满足无浏览器 AI 主链路。
- FFmpeg/native P0 能覆盖确定性剪辑，但复杂滤镜、关键帧动画和高级模板需要后续设计。
- Windows 路径、中文文件名、空格路径和 FFmpeg 参数转义必须作为测试重点。
- 大视频渲染需要控制临时文件、进度回调、取消和失败恢复。

## 暂不做

- 不先重写整个编辑器。
- 不先做云端 SaaS。
- 不先做复杂模板市场。
- 不把 Playwright/Chromium 自动化作为 AI 剪辑主链路。
