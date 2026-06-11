#!/usr/bin/env bun
import { startPackagedWebClient } from "./desktop-launcher";

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const args = process.argv.slice(2);
const port = Number(flagValue(args, "--port") ?? 4477);
if (!Number.isFinite(port) || port <= 0) {
  console.log(JSON.stringify({ ok: false, error: "--port 必须是有效端口号" }, null, 2));
  process.exit(2);
}

try {
	const result = startPackagedWebClient({
	host: flagValue(args, "--host") ?? "127.0.0.1",
	port,
	openBrowser: !args.includes("--no-open"),
	});

	console.log(
		JSON.stringify(
			{
				ok: true,
				url: result.url,
				defaultOutDir: result.paths.defaultOutDir,
				bundledRuntime: result.bundledRuntime,
				mode: "web",
			},
			null,
			2,
		),
	);
} catch (error) {
	console.log(
		JSON.stringify(
			{
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			},
			null,
			2,
		),
	);
	process.exit(1);
}

await new Promise(() => {});
