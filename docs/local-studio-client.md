# 本地桌面客户端

晴辰剪辑本地客户端的用户入口是原生 OpenCut Web 编辑器，而不是单独重做的简化界面。CLI、MCP 和 headless core 是 AI 自动剪辑主链路；Web UI 用于人工预览、调试和手动编辑。

## Windows 免环境包

构建：

```powershell
bun run build:desktop-client
```

产物：

```text
dist/qingchen-cut-win32-x64/
  QingchenCut.exe
  runtime/bun.exe
  web/apps/web/server.js
  web/apps/web/node_modules/
  bin/ffmpeg.exe
  bin/ffprobe.exe
  bin/whisper-cli.exe      # 如果 vendor/whisper 存在
  models/ggml-base.bin     # 如果 vendor/models 存在
  README.txt
  manifest.json
```

运行：

```powershell
dist/qingchen-cut-win32-x64/QingchenCut.exe
```

双击 `QingchenCut.exe` 也可以。程序会启动只监听 `127.0.0.1` 的本机 Web 服务，并打开：

```text
http://127.0.0.1:4477/projects
```

可选参数：

```powershell
QingchenCut.exe --port 4478
QingchenCut.exe --no-open
```

默认输出目录：

```text
%USERPROFILE%\Videos\Qingchen Cut
```

## GitHub Release 自动构建

仓库包含 tag release workflow：

```text
.github/workflows/release-desktop-client.yml
```

推送 `v*` tag 后，GitHub Actions 会在 `windows-latest` 上执行：

1. 安装 Bun。
2. 安装 FFmpeg。
3. 下载 whisper.cpp base bundle。
4. 运行 `bun run build:desktop-client`。
5. 压缩 `dist/qingchen-cut-win32-x64/`。
6. 上传 workflow artifact。
7. 创建或更新同名 GitHub Release，并附上 zip 和 `.sha256`。

发布命令：

```powershell
git tag v0.1.0
git push origin v0.1.0
```

用户下载 Release 里的 `qingchen-cut-v0.1.0-win32-x64.zip`，解压后运行 `QingchenCut.exe`。

## 客户端边界

- 用户看到的是原生 Web 编辑器项目页和编辑器，不是简化 Studio 页面。
- 桌面包内置 Bun runtime，仅客户端内部使用，用户不需要安装 Bun。
- 桌面包内置 FFmpeg/FFprobe；如果本机 `vendor/whisper` 和 `vendor/models` 存在，构建时也会带上 whisper.cpp 和模型。
- 本地客户端模式会填充安全的本地默认 env，避免普通用户配置数据库、Redis、Marble、Freesound 等云端变量。
- CLI/MCP/headless 仍是 AI 自动剪辑主路径；Web UI 不承载剪辑业务逻辑。

## 开发诊断 Studio

`qc studio` 是开发诊断入口，不作为用户桌面客户端主界面：

```powershell
bun run qc studio --port 4477 --out-dir docs-local/client-runs
```

它需要仓库和 Bun，适合快速验证素材分析、TTS 配音、音画同步 DSL、渲染和 contact sheet。

## 安全边界

- 默认只监听 `127.0.0.1`，不暴露到局域网。
- 不要把 token、Cookie、私有原片或个人隐私提交到 issue 或仓库。
- `docs-local/`、`dist/`、`vendor/`、测试输出和素材原片不入库。

## 当前限制

- 当前 Windows 包仍使用默认浏览器承载原生 Web；下一步会封装 WebView/安装器，做成更完整的桌面窗口。
- 原生 Web 的人工编辑体验继承 OpenCut Classic；中文化会按真实使用路径逐步补齐。
- 线上生成会在本地链路稳定后复用同一套 DSL/Core/render 后端。
