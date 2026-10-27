// The import tiler: GeoJSON in, one PMTiles file out. Stateless; the tiles Worker keeps the result in R2.
// Plain Node, no deps: the image is tippecanoe plus this file.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_BYTES = 64 * 1024 * 1024;

// -r1 and no limits: a pin thinned out of a tile is a lie. A feature's own "tippecanoe": {minzoom, maxzoom} carries the huddle levels.
const ARGS = ["-q", "-f", "-l", "import", "-Z0", "-z14", "-r1", "--no-feature-limit", "--no-tile-size-limit"];

function tippecanoe(dir) {
	return new Promise((ok, fail) => {
		const p = spawn("tippecanoe", [...ARGS, "-o", join(dir, "out.pmtiles"), join(dir, "in.geojson")]);
		let err = "";
		p.stderr.on("data", (d) => (err += d));
		p.on("error", fail);
		p.on("close", (code) => (code === 0 ? ok() : fail(new Error(err.trim() || `tippecanoe exited ${code}`))));
	});
}

async function body(req) {
	const chunks = [];
	let n = 0;
	for await (const c of req) {
		n += c.length;
		if (n > MAX_BYTES) return null;
		chunks.push(c);
	}
	return Buffer.concat(chunks);
}

createServer(async (req, res) => {
	const send = (status, data, type = "text/plain") => {
		res.writeHead(status, { "Content-Type": type });
		res.end(data);
	};
	if (req.url === "/health") return send(200, "ok");
	if (req.url !== "/tile" || req.method !== "POST") return send(404, "POST /tile");
	const geojson = await body(req);
	if (!geojson) return send(413, `imports stop at ${MAX_BYTES / 1024 / 1024} MB`);
	const dir = await mkdtemp(join(tmpdir(), "tile-"));
	const t0 = Date.now();
	try {
		await writeFile(join(dir, "in.geojson"), geojson);
		await tippecanoe(dir);
		const out = await readFile(join(dir, "out.pmtiles"));
		console.log(`tiled ${geojson.length} B → ${out.length} B in ${Date.now() - t0} ms`);
		send(200, out, "application/vnd.pmtiles");
	} catch (e) {
		console.warn(`refused ${geojson.length} B: ${e.message}`);
		send(400, e.message);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}).listen(PORT, () => console.log(`import tiler on :${PORT}`));
