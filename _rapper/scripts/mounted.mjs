// The ONE child this rapper mounts, or undefined in the workspace checkout (every child served from src/routes).
// Written by the installer as rapper/mounted.json; kept inside rapper so nothing here reaches above its own folder.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FILE = fileURLToPath(new URL("../mounted.json", import.meta.url));

/** @returns {string | undefined} the child's folder name, e.g. "getCache_OfflineMap" */
export function mountedChild() {
	if (!existsSync(FILE)) return undefined;
	const { child } = JSON.parse(readFileSync(FILE, "utf8"));
	if (typeof child !== "string" || !child) throw new Error(`${FILE}: "child" must name a folder beside rapper`);
	return child;
}
