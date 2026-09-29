// Real wire bytes for a page, straight from the Chrome DevTools Protocol: Network.loadingFinished's
// encodedDataLength, the number the Network panel itself shows. Workers are attached too, since the
// blob download runs in one.
//
//   Chrome (any profile you can see):  open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=$HOME/.cache/gc-cdp
//   node tests/netBytes.mjs --url offlinev10/debug [--port 9222] [--seconds 30] [--reload]
//
// Your own browser: switch on chrome://inspect/#remote-debugging (brave://inspect/… in Brave), then pass
//   --profile "$HOME/Library/Application Support/BraveSoftware/Brave-Browser"
// to attach through that profile's DevToolsActivePort; the browser asks you to allow it once.
//
// --url  substring of the tab to measure. --reload hard-reloads it first. Runs --seconds, then prints
// wire MB and request counts per host/first-path-segment; cache hits are counted but carry 0 bytes.

import { readFileSync } from "node:fs";
import { join } from "node:path";

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

const profile = flag("profile");
let socketUrl;
let sessionId;
if (profile) {
	const [p, path] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").trim().split("\n");
	socketUrl = `ws://127.0.0.1:${p}${path}`;
} else {
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
	socketUrl = tab.webSocketDebuggerUrl;
}

const ws = new WebSocket(socketUrl);
await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
let id = 0;
const replies = new Map();
const send = (method, params = {}, sid) => {
	ws.send(JSON.stringify({ id: ++id, method, params, sessionId: sid }));
	return new Promise((ok) => replies.set(id, ok));
};
const watch = (sid) => {
	send("Network.enable", {}, sid);
	send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid);
};

if (profile) {
	const { result } = await send("Target.getTargets");
	const tab = result.targetInfos.find((t) => t.type === "page" && t.url.includes(match));
	if (!tab) {
		console.error(`no tab matching "${match}"; open: ${result.targetInfos.filter((t) => t.type === "page").map((t) => t.url).join(" | ")}`);
		process.exit(1);
	}
	console.error(`attached to ${tab.url}`);
	sessionId = (await send("Target.attachToTarget", { targetId: tab.targetId, flatten: true })).result.sessionId;
}

const urls = new Map();
const cached = new Set();
const groups = new Map();
let failed = 0;
const bucket = (url) => {
	const u = new URL(url);
	return `${u.host}/${u.pathname.split("/")[1] ?? ""}`;
};

ws.addEventListener("message", ({ data }) => {
	const { id: replyTo, method, params, sessionId } = JSON.parse(data);
	if (replyTo) replies.get(replyTo)?.(JSON.parse(data));
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

watch(sessionId);
if (argv.includes("--reload")) send("Page.reload", { ignoreCache: true }, sessionId);
console.error(`measuring for ${seconds}s…`);
await new Promise((ok) => setTimeout(ok, seconds * 1000));
ws.close();

const mb = (b) => (b / 1048576).toFixed(2);
const rows = [...groups].sort((a, b) => b[1].bytes - a[1].bytes);
console.table(Object.fromEntries(rows.map(([k, g]) => [k, { requests: g.reqs, "wire MB": mb(g.bytes), "cache hits": g.hits }])));
console.log(`total ${mb(rows.reduce((n, [, g]) => n + g.bytes, 0))} MB over ${rows.reduce((n, [, g]) => n + g.reqs, 0)} requests, ${failed} failed`);
