// Real wire bytes for a page, straight from the Chrome DevTools Protocol: Network.loadingFinished's
// encodedDataLength, the number the Network panel itself shows. Workers are attached too, since the
// blob download runs in one.
//
//   Chrome (any profile you can see):  open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=$HOME/.cache/gc-cdp
//   node tests/netBytes.mjs --url offlinev10/debug [--port 9222] [--seconds 30] [--reload]
//
// --url  substring of the tab to measure. --reload hard-reloads it first. Runs --seconds, then prints
// wire MB and request counts per host/first-path-segment; cache hits are counted but carry 0 bytes.

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i === -1 ? fallback : argv[i + 1];
};
const match = flag("url");
if (!match) {
	console.error("--url <tab url substring> is required");
	process.exit(1);
}
const port = Number(flag("port", 9222));
const seconds = Number(flag("seconds", 30));

const targets = await fetch(`http://127.0.0.1:${port}/json/list`)
	.then((r) => r.json())
	.catch(() => {
		console.error(`no Chrome on :${port} — see the launch line at the top of this file`);
		process.exit(1);
	});
const tab = targets.find((t) => t.type === "page" && t.url.includes(match));
if (!tab) {
	console.error(`no tab matching "${match}"; open: ${targets.filter((t) => t.type === "page").map((t) => t.url).join(" | ")}`);
	process.exit(1);
}

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
let id = 0;
const send = (method, params = {}, sessionId) => ws.send(JSON.stringify({ id: ++id, method, params, sessionId }));
const watch = (sessionId) => {
	send("Network.enable", {}, sessionId);
	send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
};

const urls = new Map();
const cached = new Set();
const groups = new Map();
let failed = 0;
const bucket = (url) => {
	const u = new URL(url);
	return `${u.host}/${u.pathname.split("/")[1] ?? ""}`;
};

ws.addEventListener("message", ({ data }) => {
	const { method, params, sessionId } = JSON.parse(data);
	const key = `${sessionId ?? ""}:${params?.requestId}`;
	if (method === "Target.attachedToTarget") watch(params.sessionId);
	else if (method === "Network.requestWillBeSent") urls.set(key, params.request.url);
	else if (method === "Network.responseReceived" && (params.response.fromDiskCache || params.response.fromPrefetchCache)) cached.add(key);
	else if (method === "Network.loadingFailed") failed++;
	else if (method === "Network.loadingFinished" && urls.has(key)) {
		const g = groups.get(bucket(urls.get(key))) ?? { reqs: 0, bytes: 0, hits: 0 };
		g.reqs++;
		g.bytes += params.encodedDataLength;
		if (cached.has(key)) g.hits++;
		groups.set(bucket(urls.get(key)), g);
	}
});

watch(undefined);
if (argv.includes("--reload")) send("Page.reload", { ignoreCache: true });
console.error(`measuring ${tab.url} for ${seconds}s…`);
await new Promise((ok) => setTimeout(ok, seconds * 1000));
ws.close();

const mb = (b) => (b / 1048576).toFixed(2);
const rows = [...groups].sort((a, b) => b[1].bytes - a[1].bytes);
console.table(Object.fromEntries(rows.map(([k, g]) => [k, { requests: g.reqs, "wire MB": mb(g.bytes), "cache hits": g.hits }])));
console.log(`total ${mb(rows.reduce((n, [, g]) => n + g.bytes, 0))} MB over ${rows.reduce((n, [, g]) => n + g.reqs, 0)} requests, ${failed} failed`);
