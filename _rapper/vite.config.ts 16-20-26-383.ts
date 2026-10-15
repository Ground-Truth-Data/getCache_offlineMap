import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { noEscapeHatch } from "./src/lib/guards/noEscapePlugin.ts";
import { noRawCamera } from "./src/lib/guards/noRawCameraPlugin.ts";
import { workspaceRoot } from "./src/lib/guards/workspaceRoot.ts";
import { pdfjsWasm } from "./src/lib/vite/pdfjsWasmPlugin.ts";
import { CHILDREN, childByRepo, mountPath } from "./rig/childRegistry.ts";
import { mountedChild } from "./scripts/mounted.mjs";

// No PWA plugin on purpose: Get Cache is a Capacitor native app, no service worker.

const mountedChildRepo = (): string | undefined => mountedChild();

// The scaffold's one child, or every non-tier record in the workspace checkout.
function mountedChildRepos(): string[] {
	const one = mountedChildRepo();
	return one ? [one] : CHILDREN.filter((c) => !c.tier).map((c) => c.repo);
}

function mountedChildRoutes() {
	// The other tier splits by hostname: Get Cache routes live on the getcache host.
	const GETCACHE_ORIGIN = "http://getcache.localhost:5173";

	return mountedChildRepos().flatMap((repo) => {
		const rec = childByRepo(repo);
		if (!rec) return [];
		const solo = rec.soloPaths ?? [];
		// "/" and solo paths exist only on this side and would 404 on the other.
		return rec.paths
			.filter((p) => p !== "/" && !solo.includes(p))
			.map((p) => ({
				path: mountPath(rec, p),
				otherPath: mountPath(rec, p),
				repo,
				...(rec.app ? { otherOrigin: GETCACHE_ORIGIN } : {}),
			}));
	});
}

function otherHome(): string {
	return mountedChildRoutes()[0]?.otherPath ?? "/";
}

// Workspace mode lands on the first child; keep in sync with src/hooks.ts.
function childLandingPath(): string | undefined {
	const rec = childByRepo(mountedChildRepos()[0] ?? "");
	return rec ? mountPath(rec) : undefined;
}

// Reads the OS-granted port after "listening": Vite falls back to 5175+ when 5174 is taken.
function printLandingUrl() {
	return {
		name: "rapper-landing-url",
		apply: "serve" as const,
		configureServer(server: {
			httpServer: { once: (e: string, cb: () => void) => void } | null;
			config: { logger: { info: (msg: string) => void } };
		}) {
			const landing = childLandingPath();
			if (!landing || !server.httpServer) return;
			server.httpServer.once("listening", () => {
				const addr = (server.httpServer as unknown as {
					address: () => { port: number } | null;
				}).address();
				if (!addr) return;
				// After Vite's own "ready in" banner, not in the middle of it.
				setTimeout(() => {
					server.config.logger.info(
						`  \x1b[32m➜\x1b[0m  \x1b[1mStart here:\x1b[0m http://localhost:${addr.port}${landing}`,
					);
				}, 0);
			});
		},
	};
}

export default defineConfig(({ command }) => {
// Gated at the define, or dev-only origins are inlined into the production
// bundle; and on the sibling checkout existing, because a scaffold is a dev
// build with exactly one tier.
const hasSiblingParent = existsSync(
	fileURLToPath(new URL("../ReTreever/svelte.config.js", import.meta.url)),
);

const dev = command === "serve" && hasSiblingParent;
const tierFacts = dev
	? {
		"import.meta.env.VITE_RAPPER_TIER": JSON.stringify("rapper"),
		"import.meta.env.VITE_OTHER_TIER": JSON.stringify("retreever"),
		"import.meta.env.VITE_OTHER_ORIGIN": JSON.stringify(
			"http://retreever.localhost:5176",
		),
		// Not "/": ReTreever's "/" is a marketing homepage, not the search.
		"import.meta.env.VITE_OTHER_HOME": JSON.stringify(otherHome()),
		// Double JSON.stringify: define pastes this as literal source.
		"import.meta.env.VITE_TIER_ROUTES": JSON.stringify(
			JSON.stringify(mountedChildRoutes()),
		),
		// Fixed per tier (retreever left, rapper right), so the halves never swap sides.
		"import.meta.env.VITE_TIER_SLOT": JSON.stringify("right"),
	}
	: {};

// Ungated: true in every build. Empty in the workspace checkout, where the bar
// looks the live path up instead.
const mountedFact = {
	"import.meta.env.VITE_MOUNTED_CHILD": JSON.stringify(
		mountedChildRepo() ?? "",
	),
};

return {

	plugins: [
		printLandingUrl(),
		// Rooted at the WORKSPACE: children are siblings of rapper, so rooting at rapper/ makes the guard vacuous.
		noEscapeHatch(workspaceRoot(import.meta.url)),
		noRawCamera(workspaceRoot(import.meta.url)),
		pdfjsWasm(import.meta.url),
		tailwindcss(),
		sveltekit(),
	],

	// Keys MUST be import.meta.env.VITE_*, not bare globals: a bare __X__ throws
	// in a child cloned without rapper, and `typeof __X__` makes Vite skip the substitution.
	define: { ...tierFacts, ...mountedFact },
	// PUBLIC_ is the one browser prefix; a child reads it through import.meta.env.
	envPrefix: ["PUBLIC_"],
	server: {
		fs: {
			// SvelteKit replaces Vite's allow-list with src/ only; rig/, gc/, rt/ and every sibling 404 without this.
			allow: [".."],
		},
	},
	test: {
		silent: "passed-only",
		// Scoped to lib/ + routes/: a bare ../<child>/** reaches worker node_modules.
		include: [
			"src/**/*.{test,spec}.{js,ts}",
			"rig/**/*.{test,spec}.{js,ts}",
			"gc/**/*.{test,spec}.{js,ts}",
			"rt/**/*.{test,spec}.{js,ts}",
			...mountedChildRepos().flatMap((r) => [
				`../${r}/lib/**/*.{test,spec}.{js,ts}`,
				`../${r}/routes/**/*.{test,spec}.{js,ts}`,
			]),
		],
		// The leading ../ matters: vitest's default excludes only cover the project root,
		// and a child's service can have node_modules under lib/.
		exclude: [
			"**/node_modules/**",
			"../**/node_modules/**",
			"**/dist/**",
			"**/.svelte-kit/**",
		],
		// Without it a spy leaks across tests.
		clearMocks: true,
	},
};
});
