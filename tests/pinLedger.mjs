// Per-drop ledger: node tests/pinLedger.mjs [baseUrl]. Fresh profile, drops pins via the dev handle, prints bytes/requests by host and heap.
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://getcache.localhost:5173";
const AT = (process.env.AT ?? "-78.84,43.68").split(",").map(Number);
const browser = await chromium.launch({
	args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
});
const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

let log = [];
const starts = [];
ctx.on("request", (req) => req.url().includes("/satellite/") && starts.push(Date.now()));
ctx.on("requestfinished", async (req) => {
	let bytes = 0;
	try {
		bytes = (await req.sizes()).responseBodySize;
	} catch {}
	const u = new URL(req.url());
	log.push({ host: u.host, path: u.pathname, bytes, worker: req.frame() === null });
});
const take = () => {
	const out = log;
	log = [];
	return out;
};
const summarise = (rows) => {
	const by = {};
	for (const r of rows) {
		const k = r.path.includes("/satellite/") ? `sat@${r.host}` : r.path.endsWith(".pbf") ? `road@${r.host}` : r.host;
		by[k] ??= { n: 0, mb: 0 };
		by[k].n++;
		by[k].mb += r.bytes / 1048576;
	}
	return Object.entries(by).map(([h, v]) => `${h} n=${v.n} ${v.mb.toFixed(1)}MB`).join(" | ");
};

await page.goto(`${BASE}/app/offlinev10${process.env.DEBUG ? "/debug" : ""}?at=${AT[1]},${AT[0]}&z=8.89`);
await page.waitForFunction(() => window.__v10?.addBlob, null, { timeout: 60_000 });
await page.waitForTimeout(3000);
const boot = take();
console.log("boot:", boot.length, summarise(boot));

const cdp = await ctx.newCDPSession(page);
if (process.env.LAT) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: +process.env.LAT, downloadThroughput: -1, uploadThroughput: -1 });
const heap = async (gc) => {
	if (gc) await cdp.send("HeapProfiler.collectGarbage");
	const m = await cdp.send("Performance.getMetrics");
	return (m.metrics.find((x) => x.name === "JSHeapUsedSize").value / 1048576).toFixed(1);
};
await cdp.send("Performance.enable");

const photoCount = () =>
	page.evaluate(
		() =>
			new Promise((res) => {
				const r = indexedDB.open("gc-offlineSatellite");
				r.onsuccess = () => {
					const db = r.result;
					const q = db.transaction("photos").objectStore("photos").count();
					q.onsuccess = () => res(q.result);
				};
				r.onerror = () => res(-1);
			}),
	);

async function drop(lng, lat, label) {
	take();
	const before = await photoCount();
	const h0 = await heap(false);
	await page.evaluate(([a, b]) => window.__v10.addBlob(a, b), [lng, lat]);
	await page.waitForFunction(() => true);
	const t0 = Date.now();
	for (;;) {
		if ((await photoCount()) > before) break;
		if (Date.now() - t0 > 240_000) {
			console.log(label, "TIMEOUT");
			break;
		}
		await page.waitForTimeout(500);
	}
	await page.waitForTimeout(1500);
	const rows = take();
	const sat = rows.filter((r) => !r.host.includes("localhost") || r.worker);
	const tot = rows.reduce((s, r) => s + r.bytes, 0) / 1048576;
	const meta = await page.evaluate(
		() =>
			new Promise((res) => {
				const r = indexedDB.open("gc-offlineSatellite");
				r.onsuccess = () => {
					const out = [];
					const c = r.result.transaction("photos").objectStore("photos").openCursor();
					c.onsuccess = () => {
						const cur = c.result;
						if (!cur) return res(out);
						out.push(`${cur.key} ${cur.value.source} z${cur.value.zoom} ${cur.value.canvasPx}px ${(cur.value.blob.size / 1048576).toFixed(2)}MB`);
						cur.continue();
					};
				};
			}),
	);
	console.log("  photos:", meta.slice(-2).join(" ; "));
	const hp = await heap(false);
	const hg = await heap(true);
	if (process.env.TL && starts.length) {
		const h = {};
		for (const t of starts) h[Math.floor((t - starts[0]) / 1000)] = (h[Math.floor((t - starts[0]) / 1000)] ?? 0) + 1;
		console.log("  sat starts per second:", JSON.stringify(h));
	}
	starts.length = 0;
	const uniq = (f) => new Set(rows.filter(f).map((r) => r.path)).size;
	console.log(`  unique sat paths ${uniq((r) => r.path.includes("/satellite/"))}, unique road paths ${uniq((r) => r.path.endsWith(".pbf"))}`);
	const zs = {};
	for (const r of rows) {
		const m = r.path.match(/^\/(?:satellite\/)?(\d+)\//);
		if (!m) continue;
		const k = (r.path.includes("satellite") ? (r.worker ? "sW" : "sMain") : "r") + m[1];
		zs[k] ??= [0, 0];
		zs[k][0]++;
		zs[k][1] = +(zs[k][1] + r.bytes / 1048576).toFixed(2);
	}
	console.log("  by z:", JSON.stringify(zs));
	console.log(
		`${label}: req=${rows.length} ${tot.toFixed(1)}MB | ${summarise(rows)} | heap ${h0} -> ${hp} -> gc ${hg} MB | ${((Date.now() - t0) / 1000).toFixed(0)}s`,
	);
	return rows;
}

const mode = process.argv[3] ?? "all";
const a = await drop(AT[0], AT[1], "(a) first drop");
if (mode === "two") await drop(AT[0] + 0.02, AT[1] + 0.3, "(b)");
if (mode === "all") {
	await drop(AT[0] + 0.065, AT[1], "(b) +5km");
	await drop(AT[0], AT[1], "(c) same spot");
	for (let i = 1; i <= 10; i++) await drop(AT[0] + 0.02 * i, AT[1] + 0.3 + 0.03 * i, `(d${i})`);
}
if (process.env.DEBUG) console.log("meter:", JSON.stringify(await page.evaluate(() => window.__data().today)));
console.log("console errors:", errors.length, errors.slice(0, 3));
await browser.close();
