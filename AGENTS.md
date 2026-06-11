# Agents.md

## 项目定位

本仓库是“晴辰剪辑 Qingchen Cut”，基于 OpenCut Classic 二次开发。核心目标是 AI 原生剪辑：AI 直接通过 CLI、MCP 或本地 headless 引擎完成素材导入、时间线生成、字幕/文字/音频处理和视频导出。

人工 UI 是调试和预览入口，不是主工作流。新增能力必须优先考虑是否能被自动化稳定调用。

## 最高优先级

- 默认使用简体中文沟通。
- 不提交密钥、token、Cookie、素材原片和个人隐私数据。
- 保留 OpenCut 上游 MIT License 和必要 attribution。
- 改动前先确认当前工作区状态，不能覆盖用户未提交改动。
- 不做无关大重构；第一阶段以最小可验证闭环推进 AI 剪辑能力。

## 架构原则

### AI 控制面优先

任何剪辑能力都必须优先沉淀到可编程接口，而不是绑定 UI 事件。AI 主路径不得依赖人工打开浏览器、点击界面或 Playwright 驱动 Web UI。

推荐边界：

- `Editing DSL`: JSON 剪辑任务格式，表达素材、片段、文字、字幕、音频和导出设置。
- `Headless Core`: 无浏览器剪辑内核，负责编译 DSL、探测媒体、生成时间线和调用渲染后端。
- `CLI`: 本地命令入口，负责读取任务、访问文件系统、渲染导出、输出结构化日志。
- `MCP Server`: AI 工具协议层，调用 CLI/Core，不承载剪辑业务逻辑。
- `Web UI`: 预览、调试、人工复核和异常排查，不作为 AI 执行链路。

### 不把业务逻辑写死在组件里

OpenCut Classic 目前大量逻辑在 Web app 内。二开时优先把可复用逻辑放到领域模块或 manager 中，React 组件只负责交互和展示。

### 保持可验证

每个 Agent 能力至少要有一种可自动验证方式：

- CLI dry run
- MCP tool smoke test
- 小素材导出验收
- JSON DSL fixture 回放

没有真实验证时，不要宣称“已完成”。

## 第一阶段范围

P0 只追求 AI 可闭环出片：

- 创建项目
- 导入本地视频/音频/图片素材
- 添加主轨视频片段并设置 start/in/out/duration
- 添加文字或字幕
- 设置画布尺寸和背景
- 导出 MP4 到指定本地路径
- 全流程不依赖浏览器操作

暂不优先：

- 复杂人工编辑体验重绘
- 云端协同
- 多用户权限
- 商业模板市场
- Web UI Agent Bridge

## 开发命令

优先按锁文件和现有脚本执行：

```powershell
bun install
bun run make:fixtures      # 生成测试素材（中文/空格文件名）
bun run test:headless      # headless 链路单测（dsl/core/cli/mcp）
bun run qc <command>       # qc CLI：doctor/schema/validate/probe/plan/render/frame/analyze/contact-sheet/patch
bun dev:web                # Web 预览界面（非 AI 主链路）
bun run lint:web
```

headless 包改动后需通过：`bun run test:headless` 与各包 `bunx tsc --noEmit`。
渲染问题排查：`qc render --keep-temp` 保留临时目录（filtergraph.txt 可直接看编译产物）。

完整本地依赖：

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
docker compose up -d db redis serverless-redis-http
```

## 上游同步

`upstream` 指向 `https://github.com/OpenCut-app/opencut-classic.git`。该仓库已归档，默认不频繁同步；如需同步，先评估对本项目 Headless Core、CLI 和 DSL 的影响。
