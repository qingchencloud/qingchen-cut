# AI Agent 自动剪辑路线

## 目标

晴辰剪辑的主目标是让 AI 直接完成视频剪辑任务，不依赖人工打开界面逐步操作。理想输入是一段自然语言需求或结构化 JSON，理想输出是本地 MP4 文件和可复现的剪辑工程。

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

### Agent Bridge

浏览器内 API，挂载在受控命名空间，例如 `window.__qingchenCutAgent`。它只暴露稳定的高层能力，不泄露内部实现细节。

第一版方法：

- `health()`
- `createProject(spec)`
- `importAsset(assetSpec)`
- `applyTimeline(timelineSpec)`
- `exportProject(exportSpec)`
- `getDiagnostics()`

### Agent Runner

本地运行器负责：

- 启动或连接本地 Web 应用。
- 启动受控 Chromium。
- 把本地文件注入浏览器存储。
- 调用 Agent Bridge。
- 接收导出 buffer 并写入本地路径。
- 输出结构化日志和错误。

### MCP Server

等 Agent Runner 稳定后再封装 MCP。MCP 不直接承载剪辑逻辑，只作为工具协议层：

- `create_video_from_dsl`
- `inspect_project`
- `export_project`
- `validate_dsl`

## P0 实施顺序

1. 运行 OpenCut Classic 基线，确认本机 `bun dev:web` 和 Docker 依赖可用。
2. 增加最小 Agent Bridge，只支持读取健康状态和导出当前项目。
3. 增加本地 Runner，用 Playwright 连接页面并调用 Bridge。
4. 支持从本地路径导入单个视频素材。
5. 支持 DSL 生成单轨时间线。
6. 支持 MP4 导出到指定路径。
7. 增加 smoke test：输入一段短视频，输出一个 5 秒带标题 MP4。

## 风险

- OpenCut Classic 已归档，上游不会修复导出和浏览器兼容问题。
- 现有导出依赖浏览器、Canvas、WebCodecs 和 OPFS，批量稳定性必须实测。
- 大视频会受浏览器存储配额和内存影响。
- 完全 headless 渲染不是 P0，早期仍需要受控 Chromium。

## 暂不做

- 不先重写整个编辑器。
- 不先做云端 SaaS。
- 不先做复杂模板市场。
- 不先承诺无浏览器渲染。
