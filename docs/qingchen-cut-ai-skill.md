---
name: qingchen-cut-ai-editor
description: Use when an AI agent needs to operate Qingchen Cut / qingchen-cut through local CLI or MCP tools to create, validate, render, inspect, or debug video editing jobs.
---

# Qingchen Cut AI Skill

Copy this whole document into an AI agent when you want it to operate Qingchen Cut. The agent should use MCP tools when available and fall back to the `qc` CLI when MCP is not available.

## Mission

You are operating Qingchen Cut, an AI-native local video editing engine. Produce reproducible local MP4 videos from local media files through the repository's headless CLI or MCP server. Do not drive the Web UI with browser clicks as the main workflow.

The Web/Desktop client is for human preview and manual editing. AI automation should use Editing DSL JSON, headless core, CLI, and MCP tools.

## First Actions

1. Confirm the repository root.
2. Run environment diagnosis.
3. Inspect or analyze source media.
4. Read the DSL schema before writing a new job.
5. Generate or patch a DSL job.
6. Validate before rendering.
7. Extract 2-3 frames and inspect composition, title overflow, subtitle safe area, and timing.
8. Patch and re-check if needed.
9. Render MP4.
10. Generate a contact sheet and report paths, duration, resolution, file size, validation result, and remaining risks.

## MCP Setup

If the repo contains `.mcp.json`, an MCP-capable client can usually open the repository and load the server directly:

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

For Codex-style local config, use the same command and args in the client's MCP config. Do not commit private local MCP config files.

If `bun` is not on PATH, resolve the Bun executable first and use its absolute path as `command`. On Windows this is often under `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Oven-sh.Bun_*`.

## MCP Tools

Use these tools directly when the `qingchen-cut` MCP server is available:

- `doctor`: environment diagnosis.
- `get_dsl_schema`: read Editing DSL schema before writing jobs.
- `probe_media`: duration, resolution, fps, rotation, and audio/video stream metadata.
- `analyze_media`: scene cuts, silence segments, and loudness.
- `validate_dsl`: schema, semantic, filesystem, and ffprobe validation.
- `plan_render`: dry-run FFmpeg plan and filtergraph.
- `extract_frame`: visual self-check frames from the final DSL.
- `patch_dsl`: JSON Patch edits; prefer this for small fixes.
- `render_video`: render MP4.
- `contact_sheet`: grid overview of a rendered job or source media.
- `transcribe_media`: local whisper.cpp speech-to-text and optional SRT.
- `synthesize_speech`: local Windows SAPI text-to-speech WAV.
- `create_narrated_dsl`: script text to voice WAVs, SRT, and voice-synced DSL.
- `render_template`: instantiate `${var}` DSL templates.
- `render_batch`: render multiple jobs sequentially.

## CLI Fallback

From the repository root:

```powershell
bun install
bun run qc doctor
bun run qc schema
bun run qc probe <media>
bun run qc analyze <media>
bun run qc validate <job.json>
bun run qc frame <job.json> --at <seconds> --out <frame.png>
bun run qc render <job.json>
bun run qc contact-sheet <job.json> --out <sheet.png>
```

Narration:

```powershell
bun run qc tts --text "晴辰剪辑自动配音" --out voice.wav
bun run qc narrate --script script.txt --video input.mp4 --bgm bgm.mp3 --out-dir out/narration --out-job job.json --out output.mp4
bun run qc validate job.json
bun run qc render job.json
```

Transcription:

```powershell
bun script/install-whisper.ts
bun run qc transcribe input.mp4 --lang zh --srt out.srt
```

Templates and batches:

```powershell
bun run qc template template.json --vars vars.json --out job.json
bun run qc batch job-a.json job-b.json
```

## Common Workflows

Existing media edit:

1. `doctor`.
2. `probe_media` or `qc probe`.
3. `analyze_media` or `qc analyze`.
4. Write DSL with video clips, text tracks, subtitle track, audio track, and export output.
5. `validate_dsl`.
6. `extract_frame` at beginning, middle, and near the end.
7. Patch if text/subtitles overflow.
8. `render_video`.
9. `contact_sheet`.

Script-to-video with local TTS:

1. Split the script into short paragraphs.
2. Use `create_narrated_dsl` or `qc narrate`.
3. Validate the generated DSL.
4. Extract frames and patch title/subtitle sizes if needed.
5. Render and create a contact sheet.

AI-generated stills to promo video:

1. Generate or collect image assets outside the DSL.
2. Current DSL v1 does not have native image clips. Convert images to short MP4 clips with FFmpeg first, then use those clips as video assets.
3. Use ASS subtitles for polished promo videos when fixed font size, outline, and bottom margin matter.
4. Probe generated clips and set `out` to the actual probed duration, not the intended duration.

External TTS gateway:

1. If the user provides a TTS gateway base URL, read its docs first.
2. Prefer stable preset voices and save generated WAV files locally.
3. Record `job_id`, `asset_id`, `voice_id`, text, and output path for debugging.
4. Use the generated WAV files as DSL audio assets.
5. Synchronize video/subtitle timing to the probed WAV durations.

## DSL Rules

- Use absolute paths for user media when possible.
- Keep generated media, frames, and contact sheets out of Git unless the user explicitly asks to commit them.
- Do not commit source videos, private assets, tokens, cookies, or personal data.
- Treat the Editing DSL as the source of truth. The rendered MP4 should be reproducible from the DSL and local assets.
- For voiceover jobs, synchronize clip timings to real audio duration from probe/TTS output.
- Keep BGM below narration. Voice intelligibility wins over music.
- For text overlays, prefer shorter lines and inspect frames. Long text should be split with `\n` or moved to subtitles.
- For SRT subtitles, inspect line breaks. For polished videos, prefer ASS subtitles with explicit style.

## Minimum Acceptance Checklist

Before saying the edit is complete, provide evidence for:

- `doctor` result.
- Source media probe/analyze result.
- DSL validation result.
- 2-3 extracted frame paths and what was checked.
- Rendered MP4 path, duration, resolution, and size.
- Contact sheet path.
- Any patches applied after visual review.
- Remaining risks, especially missing fonts, missing FFmpeg, unavailable TTS, missing whisper model, or unverified external assets.

## Issue Reports

If something fails, ask the user to open a GitHub issue using the **AI editing / MCP / CLI failure** template:

https://github.com/qingchencloud/qingchen-cut/issues/new/choose

Include:

- OS, shell, Bun version, and Qingchen Cut commit hash.
- Whether MCP or CLI was used.
- The exact command or MCP tool call.
- The DSL JSON, with private paths or personal data redacted.
- Full JSON output from the failed tool or command, especially `issues[]`.
- `qc doctor` output.
- Input media metadata from `probe_media` / `qc probe`.
- Frame screenshots, contact sheet, or short rendered output if relevant.

Security issues or leaked secrets should not be posted publicly. Follow `.github/SECURITY.md` instead.
