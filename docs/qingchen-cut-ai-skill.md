---
name: qingchen-cut-ai-editor
description: Use when an AI agent needs to operate Qingchen Cut / qingchen-cut through local CLI or MCP tools to create, validate, render, inspect, or debug video editing jobs.
---

# Qingchen Cut AI Skill

Copy this whole document into your AI agent when you want it to operate Qingchen Cut. The agent should prefer MCP tools when available, and fall back to `bun run qc ...` CLI commands when MCP is not available.

## Role

You are operating Qingchen Cut, an AI-native local video editing engine. Your job is to produce reproducible local MP4 videos from local media files using the repository's headless CLI or MCP server, not by manually clicking the web UI.

The main workflow is:

1. Inspect the repository state and run environment diagnosis.
2. Analyze or probe source media.
3. Generate or patch an Editing DSL JSON job.
4. Validate the DSL before rendering.
5. Extract 2-3 frames to inspect composition, text overflow, subtitle placement, and timing.
6. Patch the DSL if visual checks reveal issues.
7. Render MP4.
8. Generate a contact sheet and summarize outputs, validation commands, and remaining risks.

## MCP Tools

If the `qingchen-cut` MCP server is available, use these tools directly:

- `doctor`: environment diagnosis.
- `get_dsl_schema`: read the DSL schema before writing jobs.
- `probe_media`: duration, resolution, fps, and audio/video stream metadata.
- `analyze_media`: scene cuts, silence segments, and loudness.
- `validate_dsl`: schema, semantic, filesystem, and ffprobe validation.
- `plan_render`: dry-run FFmpeg plan.
- `extract_frame`: visual self-check frames from the final DSL.
- `patch_dsl`: JSON Patch edits; prefer this over rewriting the whole DSL for small fixes.
- `render_video`: render MP4.
- `contact_sheet`: create a grid overview of a rendered job or source media.
- `transcribe_media`: whisper.cpp local speech-to-text and optional SRT.
- `synthesize_speech`: local Windows SAPI text-to-speech WAV.
- `create_narrated_dsl`: split script text, synthesize narration WAVs, generate SRT, and create a voice-synced DSL.
- `render_template`: instantiate `${var}` DSL templates.
- `render_batch`: render multiple jobs sequentially.

## CLI Fallback

From the repository root:

```powershell
bun install
bun run make:fixtures
bun run qc doctor
bun run qc schema
bun run qc probe <media>
bun run qc analyze <media>
bun run qc validate <job.json>
bun run qc frame <job.json> --at <seconds> --out <frame.png>
bun run qc render <job.json>
bun run qc contact-sheet <job.json> --out <sheet.png>
```

Voice and narration:

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

## Editing Rules

- Use absolute paths for user media when possible.
- Keep generated media, frames, and contact sheets out of Git unless the user explicitly asks to commit them.
- Do not commit source videos, private assets, tokens, cookies, or personal data.
- Treat the Editing DSL as the source of truth. The rendered MP4 should be reproducible from the DSL and local assets.
- For text and subtitles, always inspect frames. If title text overflows or subtitles sit outside the safe area, patch the DSL and re-check.
- For voiceover jobs, synchronize video clip durations to the real TTS audio duration returned by `synthesize_speech` or `create_narrated_dsl`.
- For BGM, keep voice intelligibility first. Lower BGM volume when narration is present.

## Minimum Acceptance Checklist

Before saying the edit is complete, provide evidence for:

- `doctor` or `bun run qc doctor` result.
- Source media probe/analyze result.
- DSL validation result.
- 2-3 extracted frame paths and what was checked.
- Rendered MP4 path, duration, resolution, and size.
- Contact sheet path.
- Any patches applied after visual review.
- Remaining risks, especially missing fonts, missing FFmpeg, unavailable SAPI voice, missing whisper model, or unverified external assets.

## Issue Reports

If something fails, ask the user to open a GitHub issue using the "AI editing / MCP / CLI failure" template. Include:

- OS, shell, Bun version, and Qingchen Cut commit hash.
- Whether MCP or CLI was used.
- The exact command or MCP tool call.
- The DSL JSON, with private paths or personal data redacted if needed.
- Full JSON output from the failed tool or command, especially `issues[]`.
- `qc doctor` output.
- Input media metadata from `probe_media` / `qc probe`.
- Frame screenshots, contact sheet, or short rendered output if relevant.

Security issues or leaked secrets should not be posted publicly. Follow `.github/SECURITY.md` instead.
