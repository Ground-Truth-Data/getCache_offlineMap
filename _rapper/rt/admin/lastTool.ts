// Where each parent pill goes: the last TOOL you used under it, so switching
// ReTreever → Foundr → ReTreever lands you back on the screen you left rather
// than on the parent's default. Path plus query, because ?site= (Foundr) and
// ?type= (Orgs) are part of where you were.
//
// localStorage, not the URL or a cookie: this is one browser's habit, not a
// link worth sending anyone and not something the server needs to know.

const hasStorage = () => typeof localStorage !== "undefined";
const key = (parent: string) => `admin:lastTool:${parent}`;

export function rememberTool(parent: string, pathWithSearch: string): void {
	if (!hasStorage()) return;
	try {
		localStorage.setItem(key(parent), pathWithSearch);
	} catch {
		/* private mode / quota — the pill just falls back to home */
	}
}

export function lastTool(parent: string): string | null {
	if (!hasStorage()) return null;
	try {
		return localStorage.getItem(key(parent));
	} catch {
		return null;
	}
}
