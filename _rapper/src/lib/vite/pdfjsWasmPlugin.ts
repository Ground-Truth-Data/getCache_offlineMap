/**
 * pdf.js decodes JPEG 2000 (ArcMap's basemap encoding) with an OpenJPEG wasm
 * it fetches at run time from a directory it is told about, by fixed file
 * name. Vite hashes asset names, so `?url` imports cannot point pdf.js at
 * them: this serves `node_modules/pdfjs-dist/wasm/` verbatim under one public
 * path in dev and emits the same files into the client build.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import type { Plugin } from "vite";

/** The path pdf.js is given as `wasmUrl`. Trailing slash is required by pdf.js. */
export const PDFJS_WASM_PUBLIC_PATH = "/pdfjs/wasm/";

const TYPES: Record<string, string> = {
	".wasm": "application/wasm",
	".js": "text/javascript",
};

function wasmDir(from: string): string {
	const require = createRequire(from);
	return join(dirname(require.resolve("pdfjs-dist/package.json")), "wasm");
}

function served(dir: string): string[] {
	return readdirSync(dir).filter((f) => /\.(wasm|js)$/.test(f));
}

export function pdfjsWasm(from: string): Plugin {
	const dir = wasmDir(from);
	let ssr = false;
	return {
		name: "pdfjs-wasm",
		configResolved(config) {
			ssr = !!config.build.ssr;
		},
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const url = req.url?.split("?")[0] ?? "";
				if (!url.startsWith(PDFJS_WASM_PUBLIC_PATH)) return next();
				const name = basename(url);
				if (!served(dir).includes(name)) return next();
				const ext = name.slice(name.lastIndexOf("."));
				res.setHeader("Content-Type", TYPES[ext] ?? "application/octet-stream");
				res.end(readFileSync(join(dir, name)));
			});
		},
		generateBundle() {
			if (ssr) return;
			for (const name of served(dir)) {
				this.emitFile({
					type: "asset",
					fileName: `${PDFJS_WASM_PUBLIC_PATH.slice(1)}${name}`,
					source: readFileSync(join(dir, name)),
				});
			}
		},
	};
}
