# Agents.md

## 项目定位

本仓库是“晴辰剪辑 Qingchen Cut”，基于 OpenCut Classic 二次开发。核心目标是 AI 原生剪辑：AI 直接通过脚本、MCP、本地 Agent Runner 或浏览器内控制 API 完成素材导入、时间线生成、字幕/文字/音频处理和视频导出。

人工 UI 是调试和预览入口，不是主工作流。新增能力必须优先考虑是否能被自动化稳定调用。

## 最高优先级

- 默认使用简体中文沟通。
- 不提交密钥、token、Cookie、素材原片和个人隐私数据。
- 保留 OpenCut 上游 MIT License 和必要 attribution。
- 改动前先确认当前工作区状态，不能覆盖用户未提交改动。
- 不做无关大重构；第一阶段以最小可验证闭环推进 AI 剪辑能力。

## 架构原则

### AI 控制面优先

任何剪辑能力都应尽量沉淀到可编程接口，而不是只绑定 UI 事件。

推荐边界：

- `Agent Bridge`: 浏览器内稳定 API，封装 EditorCore / storage / renderer 调用。
- `Agent Runner`: Node/Playwright/MCP 层，负责文件系统、浏览器生命周期、导出落盘。
- `Editing DSL`: JSON 剪辑任务格式，表达素材、片段、文字、字幕、音频和导出设置。
- `Web UI`: 预览、调试、人工复核和异常排查。

### 不把业务逻辑写死在组件里

OpenCut Classic 目前大量逻辑在 Web app 内。二开时优先把可复用逻辑放到领域模块或 manager 中，React 组件只负责交互和展示。

### 保持可验证

每个 Agent 能力至少要有一种可自动验证方式：

- Playwright smoke test
- CLI dry run
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

暂不优先：

- 复杂人工编辑体验重绘
- 云端协同
- 多用户权限
- 商业模板市场
- 完全无浏览器 headless 渲染

## 开发命令

优先按锁文件和现有脚本执行：

```powershell
bun install
bun dev:web
bun run lint:web
bun test
```

完整本地依赖：

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
docker compose up -d db redis serverless-redis-http
```

## 上游同步

`upstream` 指向 `https://github.com/OpenCut-app/opencut-classic.git`。该仓库已归档，默认不频繁同步；如需同步，先评估对本项目 Agent Bridge 和 DSL 的影响。
