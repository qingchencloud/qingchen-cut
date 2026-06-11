# 晴辰剪辑 Qingchen Cut

晴辰剪辑是面向 AI 自动剪辑的本地视频编辑工具。项目基于
[OpenCut Classic](https://github.com/OpenCut-app/opencut-classic) 二次开发，目标不是做一个需要人工持续拖拽时间线的剪辑器，而是做一个能被 AI 直接操作、批量生成视频、可本地私有化运行的剪辑工作台。

## 产品目标

- AI 通过脚本、MCP 或本地任务接口直接创建项目、导入素材、编排时间线并导出成片。
- 人工 UI 只作为调试、预览、复核和紧急修正入口，不作为主工作流依赖。
- 优先支持本地素材、本地渲染、本地导出，避免把原始视频上传到第三方服务。
- 第一阶段聚焦确定性剪辑：裁切、拼接、字幕、标题、音量、变速、画布比例和 MP4 导出。
- 保留 OpenCut 的 Web 编辑器能力，但逐步抽离出 AI 可调用的控制面和剪辑 DSL。

## 初始技术路线

当前基线来自 OpenCut Classic。它的项目和素材主要存储在浏览器 IndexedDB / OPFS 中，导出在浏览器内通过 Canvas、WebCodecs 和 `mediabunny` 完成。因此第一阶段不直接做服务端渲染，而是在现有 Web 编辑器上增加 AI 控制层：

1. `Agent Bridge`: 暴露稳定的浏览器内 API，例如创建项目、导入素材、添加片段、添加文字、导出视频。
2. `Agent Runner`: 本地命令行或 MCP 工具，负责启动浏览器、调用 Agent Bridge、保存导出文件。
3. `Editing DSL`: 用 JSON 描述剪辑任务，让 AI 可以生成可复现的剪辑计划。
4. `Export Pipeline`: 将现有下载式导出改造成可被自动化捕获并写入指定路径的导出流程。

详细路线见 [docs/ai-agent-roadmap.md](docs/ai-agent-roadmap.md)。

## 开发环境

### 前置依赖

- [Bun](https://bun.sh/docs/installation)
- [Docker](https://docs.docker.com/get-docker/) 和 Docker Compose

Docker 用于本地数据库和 Redis。纯前端调试可先跳过，但后续 Agent Runner 验收建议使用完整环境。

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

- `apps/web/`: Next.js Web 编辑器，当前主要改造入口。
- `apps/desktop/`: OpenCut Classic 继承的桌面实验代码，暂不作为主线。
- `rust/`: OpenCut 的跨平台核心和 WASM 相关代码。
- `docs/`: 晴辰剪辑的二开路线、架构和验证记录。

## 上游和许可证

本项目基于 OpenCut Classic，遵循原项目 MIT License。原始项目已经归档且不再维护；晴辰剪辑会在私有 fork 中按 AI 自动剪辑目标继续演进。

保留 `LICENSE` 中的 MIT 许可文本和上游版权声明。
