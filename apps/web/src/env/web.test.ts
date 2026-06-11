import { describe, expect, test } from "bun:test";
import { createWebEnv } from "./web";

describe("web env local client mode", () => {
	test("fills safe local defaults so the packaged desktop app does not need db or cloud services", () => {
		const env = createWebEnv({
			NODE_ENV: "production",
			QC_LOCAL_CLIENT: "1",
			PORT: "4477",
		});

		expect(env.NEXT_PUBLIC_SITE_URL).toBe("http://127.0.0.1:4477");
		expect(env.NEXT_PUBLIC_QC_CLIENT_MODE).toBe("desktop");
		expect(env.DATABASE_URL).toStartWith("postgresql://local-client:");
		expect(env.BETTER_AUTH_SECRET).toBe("qingchen-local-client");
		expect(env.UPSTASH_REDIS_REST_URL).toBe("http://127.0.0.1:1");
		expect(env.FREESOUND_CLIENT_ID).toBe("local-client");
	});
});
