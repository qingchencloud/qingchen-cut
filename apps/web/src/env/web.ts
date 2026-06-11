import { z } from "zod";

const webEnvSchema = z.object({
	// Node
	NODE_ENV: z.enum(["development", "production", "test"]),
	QC_LOCAL_CLIENT: z.string().optional(),
	ANALYZE: z.string().optional(),
	NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),

	// Public
	NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
	NEXT_PUBLIC_MARBLE_API_URL: z.url(),
	NEXT_PUBLIC_QC_CLIENT_MODE: z.enum(["web", "desktop"]).default("web"),

	// Server
	DATABASE_URL: z.string().refine(
		(url) =>
			url.startsWith("postgres://") || url.startsWith("postgresql://"),
		"DATABASE_URL must be a postgres:// or postgresql:// URL",
	),

	BETTER_AUTH_SECRET: z.string(),
	UPSTASH_REDIS_REST_URL: z.url(),
	UPSTASH_REDIS_REST_TOKEN: z.string(),
	MARBLE_WORKSPACE_KEY: z.string(),
	FREESOUND_CLIENT_ID: z.string(),
	FREESOUND_API_KEY: z.string(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

type RawEnv = Record<string, string | undefined>;

function withLocalClientDefaults(env: RawEnv): RawEnv {
	if (env.QC_LOCAL_CLIENT !== "1" && env.NODE_ENV !== "test") return env;
	const port = env.PORT || "4477";
	const siteUrl = env.NEXT_PUBLIC_SITE_URL || `http://127.0.0.1:${port}`;

	return {
		NEXT_PUBLIC_MARBLE_API_URL: "http://127.0.0.1:1",
		DATABASE_URL: "postgresql://local-client:local-client@127.0.0.1:1/local-client",
		BETTER_AUTH_SECRET: "qingchen-local-client",
		UPSTASH_REDIS_REST_URL: "http://127.0.0.1:1",
		UPSTASH_REDIS_REST_TOKEN: "local-client",
		MARBLE_WORKSPACE_KEY: "local-client",
		FREESOUND_CLIENT_ID: "local-client",
		FREESOUND_API_KEY: "local-client",
		...env,
		NEXT_PUBLIC_SITE_URL: siteUrl,
		NEXT_PUBLIC_QC_CLIENT_MODE: env.NEXT_PUBLIC_QC_CLIENT_MODE || "desktop",
	};
}

export function createWebEnv(env: RawEnv): WebEnv {
	return webEnvSchema.parse(withLocalClientDefaults(env));
}

export const webEnv = createWebEnv(process.env);
