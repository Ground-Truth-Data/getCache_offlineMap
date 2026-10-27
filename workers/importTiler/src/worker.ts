// Key gate in front of the tiler container, so only the tiles Worker can spend its CPU.

import { Container, getContainer } from "@cloudflare/containers";

export class ImportTilerContainer extends Container {
	defaultPort = 8080;
	// Imports are rare; an idle instance bills memory until it sleeps.
	sleepAfter = "1m";
}

interface Env {
	IMPORT_TILER: DurableObjectNamespace<ImportTilerContainer>;
	GC_importTiler_key: string;
}

// The object keeps the image it first booted: bump with every server.mjs or Dockerfile change, or the old image keeps answering.
const CONTAINER_GENERATION = "rev1";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (new URL(request.url).pathname !== "/health" && request.headers.get("authorization") !== `Bearer ${env.GC_importTiler_key}`)
			return new Response("unauthorized", { status: 401 });
		return getContainer(env.IMPORT_TILER, CONTAINER_GENERATION).fetch(request);
	},
};
