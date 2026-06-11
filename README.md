# 晴辰剪辑 Qingchen Cut

晴辰剪辑是面向 AI 自动剪辑的本地视频编辑工具。项目基于
[OpenCut Classic](https://github.com/OpenCut-app/opencut-classic) 二次开发，目标不是做一个需要人工持续拖拽时间线的剪辑器，而是做一个能被 AI 通过 CLI/MCP 直接操作、批量生成视频、可本地运行的剪辑工作台。

## 产品目标

- AI 通过 CLI、MCP 或本地 headless 任务接口直接创建项目、导入素材、编排时间线并导出成片。
- 人工 UI 只作为调试、预览、复核和紧急修正入口，不作为主工作流依赖。
- 主执行链路不依赖人工打开浏览器，也不依赖 Playwright 驱动 Web UI。
- 优先支持本地素材、本地渲染、本地导出，避免把原始视频上传到第三方服务。
- 第一阶段聚焦确定性剪辑：裁切、拼接、字幕、标题、配音、配乐、音量、变速、画布比例和 MP4 导出。
- 保留 OpenCut 的 Web 编辑器能力作为预览/调试界面，但 AI 主路径必须走可编程接口。

## 初始技术路线

当前基线来自 OpenCut Classic。它的项目和素材主要存储在浏览器 IndexedDB / OPFS 中，导出在浏览器内通过 Canvas、WebCodecs 和 `mediabunny` 完成。这个路径适合人工 Web 编辑器，不适合作为 AI 无人值守主链路。

第一阶段路线改为无浏览器主路径：

1. `Editing DSL`: 用 JSON 描述剪辑任务，让 AI 可以生成可复现的剪辑计划。
2. `Headless Core`: 在 Node/Rust 层解析 DSL、探测媒体、编译时间线并调用渲染后端。
3. `CLI`: 提供 `validate`、`probe`、`render` 等命令，直接读写本地文件。
4. `MCP Server`: 在 CLI/Core 稳定后封装成 AI 可调用工具。
5. `Web UI`: 仅作为工程预览、人工复核和调试入口。

详细路线见 [docs/ai-agent-roadmap.md](docs/ai-agent-roadmap.md)。

## 当前进展：P0 闭环已可用

headless 主链路（M0~M3）已经落地，AI 不开浏览器即可完成"校验 → 渲染 → 视觉复核"全流程：

```powershell
bun install
bun run qc doctor                                  # 环境诊断：FFmpeg/滤镜/中文字体
bun run qc schema                                  # 输出 Editing DSL 的 JSON Schema
bun run qc validate fixtures/jobs/valid-full.json  # 四层校验，结构化错误带修复建议
bun run qc plan fixtures/jobs/valid-full.json      # dry-run：输出 FFmpeg 渲染计划
bun run qc render fixtures/jobs/valid-full.json    # 渲染 MP4，NDJSON 进度
bun run qc frame fixtures/jobs/valid-full.json --at 1.0 --out out.png   # 抽帧视觉复核
bun run qc contact-sheet fixtures/jobs/valid-full.json --out sheet.png  # 九宫格速览
bun run qc analyze <素材>                          # 场景切换/静音段/响度分析
bun run qc patch <job.json> --ops <ops.json>       # JSON Patch 增量改 DSL
bun run qc transcribe <素材> --lang zh --srt out.srt # whisper.cpp 本地转写（先装：bun script/install-whisper.ts）
bun run qc tts --text "晴辰剪辑自动配音" --out voice.wav # Windows SAPI 本地 TTS
bun run qc narrate --script script.txt --video input.mp4 --bgm bgm.mp3 --out-dir out/narration --out-job job.json --out out.mp4
                                                     # 文案分段配音 → WAV/SRT → 音画同步 DSL
bun run qc template <tpl.json> --vars <vars.json> --out <job.json>  # 模板+变量 → 任务
bun run qc batch <job1.json> <job2.json>           # 批量渲染，逐任务进度+汇总
```

测试素材先跑 `bun run make:fixtures` 生成；单测 `bun run test:headless`。

MCP：仓库根目录 [.mcp.json](.mcp.json) 已配置 `qingchen-cut` server（15 个工具，覆盖
schema/校验/探测/分析/渲染/抽帧/缩略图/增量修改/转写/配音/文案同步 DSL）。用 Claude Code 等 MCP 客户端打开
本仓库即可让 AI 直接调用剪辑引擎。

## 免环境客户端方向

当前仓库优先把 AI 可调用的 headless 能力做稳；下一阶段会把它包装成普通用户可下载的客户端。目标是用户不需要理解 Bun、FFmpeg、whisper、MCP 或环境变量：

- 客户端内置 `qc` headless engine、MCP server、FFmpeg/FFprobe、可选 whisper.cpp 与默认模型。
- 首次启动自动跑环境诊断，并在缺少模型或权限时给出一键修复。
- 用户可以选择“自然语言需求 + 本地素材”，客户端调用同一套 DSL/CLI/MCP 能力完成剪辑。
- 高级用户仍可导出 DSL、查看日志、抽帧、contact sheet，并把失败报告直接附到 GitHub Issue。

短期实现会优先复用现有 `packages/core` / `packages/cli` / `packages/mcp`，客户端只做打包、素材选择、任务管理、预览和诊断，不把剪辑业务逻辑重新写进 UI。

## 给 AI 使用

如果你想让任意 AI 直接操作晴辰剪辑，把 [docs/qingchen-cut-ai-skill.md](docs/qingchen-cut-ai-skill.md) 的全文发给它即可。这个文档说明了：

- AI 应优先调用哪些 MCP 工具。
- 没有 MCP 时如何用 `bun run qc ...` CLI 兜底。
- 如何完成素材分析、DSL 生成、校验、抽帧自检、渲染和 contact sheet 速览。
- 如何做文案配音：`synthesize_speech` / `create_narrated_dsl` 或 `qc tts` / `qc narrate`。
- 出问题时需要收集哪些诊断信息。

推荐给 AI 的最短指令：

```text
请阅读并遵守这个 Qingchen Cut AI Skill，然后用本地 MCP/CLI 完成我的视频剪辑任务：
<粘贴 docs/qingchen-cut-ai-skill.md 全文>
```

## 问题反馈

如果 AI 剪辑、MCP、CLI、渲染、抽帧、TTS 配音或转写失败，请在 GitHub Issues 里选择 **AI editing / MCP / CLI failure** 模板。提交前尽量附上：

- `bun run qc doctor` 或 MCP `doctor` 输出。
- 失败的命令或 MCP tool call。
- 最小可复现 DSL JSON。
- `issues[]` JSON、抽帧图、contact sheet 或短成片。
- 系统平台、shell、Bun 版本和当前 commit。

不要公开提交 token、Cookie、私有原片或个人隐私数据；安全问题请按 [.github/SECURITY.md](.github/SECURITY.md) 处理。

## 开发环境

### 前置依赖

- [Bun](https://bun.sh/docs/installation)
- [Docker](https://docs.docker.com/get-docker/) 和 Docker Compose

Docker 用于本地数据库和 Redis。纯前端调试可先跳过；AI 主链路验收优先使用 CLI/MCP 和本地媒体 fixture。

### 本地启动

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
docker compose up -d db redis serverless-redis-http
bun install
bun dev:web
```

Web 应用默认运行在 [http://localhost:3000](http://localhost:3000)。

### Docker 自托管

```powershell
docker compose up -d
```

完整 Docker 应用默认运行在 [http://localhost:3100](http://localhost:3100)。

## 仓库结构

- `packages/dsl/`: Editing DSL schema（zod）、JSON Schema 导出、语义校验、JSON Patch。
- `packages/core/`: headless 引擎：FFmpeg 解析、媒体探测/分析、DSL→filtergraph 编译、渲染/抽帧/缩略图。
- `packages/cli/`: `qc` 命令行，全 JSON 输出，AI 优先设计。
- `packages/mcp/`: MCP server，薄封装 core。
- `fixtures/`: DSL 任务样例与测试素材生成脚本（中文/空格路径为一等测试对象）。
- `apps/web/`: Next.js Web 编辑器，保留为预览和调试入口。
- `apps/desktop/`: OpenCut Classic 继承的桌面实验代码，暂不作为主线。
- `rust/`: OpenCut 的跨平台核心和 WASM 相关代码。
- `docs/`: 晴辰剪辑的二开路线、架构和验证记录。

## 上游和许可证

本项目基于 OpenCut Classic，遵循原项目 MIT License。原始项目已经归档且不再维护；晴辰剪辑会在公开仓库中按 AI 自动剪辑目标继续演进。

保留 `LICENSE` 中的 MIT 许可文本和上游版权声明。
