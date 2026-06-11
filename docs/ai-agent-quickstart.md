# AI 快速接入指南

这份文档给想让 AI 直接操作晴辰剪辑的人看。最短路径是：把 [Qingchen Cut AI Skill](qingchen-cut-ai-skill.md) 全文发给你的 AI，然后让它使用本仓库的 MCP 或 CLI 完成剪辑。

## 最短指令

复制下面这段给 AI，然后追加你的剪辑需求和素材路径：

```text
请阅读并遵守这个 Qingchen Cut AI Skill。你必须优先使用 qingchen-cut MCP 工具；如果当前客户端没有 MCP，就在仓库根目录使用 bun run qc ... CLI。剪辑完成前必须 doctor、probe/analyze、validate、抽帧自检、render、contact-sheet，并报告产物路径和剩余风险。

<粘贴 docs/qingchen-cut-ai-skill.md 全文>
```

## MCP 接入

仓库根目录已经提供 `.mcp.json`：

```json
{
	"mcpServers": {
		"qingchen-cut": {
			"command": "bun",
			"args": ["packages/mcp/src/server.ts"]
		}
	}
}
```

支持 MCP 的 AI 客户端打开本仓库后，应能看到 `qingchen-cut` 工具。首次使用建议让 AI 先调用：

1. `doctor`
2. `get_dsl_schema`
3. `probe_media` 或 `analyze_media`
4. `validate_dsl`

## CLI 接入

没有 MCP 时，在仓库根目录使用：

```powershell
bun install
bun run qc doctor
bun run qc schema
bun run qc probe <media>
bun run qc analyze <media>
bun run qc validate <job.json>
bun run qc frame <job.json> --at 1 --out frame.png
bun run qc render <job.json>
bun run qc contact-sheet <job.json> --out sheet.png
```

配音工作流：

```powershell
bun run qc narrate --script script.txt --video input.mp4 --bgm bgm.mp3 --out-dir out --out-job job.json --out output.mp4
bun run qc validate job.json
bun run qc render job.json
```

## 桌面客户端

普通用户可以从 GitHub Release 下载 Windows 安装器：

https://github.com/qingchencloud/qingchen-cut/releases

客户端用于人工导入、预览、微调和导出。AI 自动剪辑主路径仍是 MCP/CLI/headless core，不依赖人工点击界面。

当前 Windows 包会启动本机服务并优先用 Edge app window 打开独立客户端窗口。找不到 Edge 时才回退到默认浏览器。后续会继续升级为纯 WebView2 原生壳。

## 让 AI 自检成片

不要让 AI 只说“渲染完成”。至少要求它给出：

- `doctor` 结果。
- 素材 `probe` / `analyze` 摘要。
- `validate` 是否通过。
- 2 到 3 张抽帧路径，以及检查了什么。
- MP4 路径、时长、分辨率、文件大小。
- contact sheet 路径。
- 如果文字溢出、字幕太低、配乐盖过人声，必须 patch 后重跑。

## 提交问题

如果 AI 剪辑、MCP、CLI、渲染、抽帧、TTS 配音或转写失败，请到 GitHub Issues 选择 **AI editing / MCP / CLI failure**：

https://github.com/qingchencloud/qingchen-cut/issues/new/choose

建议附上：

- 系统、shell、Bun 版本、commit hash。
- 使用 MCP 还是 CLI。
- 失败命令或 MCP tool call。
- `qc doctor` / MCP `doctor` 输出。
- 最小可复现 DSL JSON。
- 完整 JSON 错误，尤其是 `issues[]`。
- 相关抽帧、contact sheet 或短成片。

不要公开提交 token、Cookie、私有原片、个人隐私和生产敏感数据。安全问题按 `.github/SECURITY.md` 处理。
