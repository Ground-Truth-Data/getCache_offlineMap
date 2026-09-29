/**
 * Loop breaker, not a budget: one pin legitimately costs ~22 MB (roads + a MapTiler photo), so the
 * ceiling sits far above any real session and only a runaway reaches it. It stops fetching and says
 * so in the console, never on screen.
 * Bytes are counted at the fetch, one tile at a time, so a bake stuck in a loop is stopped
 * mid-loop rather than reported after the fact. A reload is a new session.
 */

export const SESSION_BYTE_CAP = 500 * 1024 * 1024;

export const sessionCap = $state({ spent: 0, tripped: false });

/** Count bytes just fetched. False once the cap is crossed (the crossing call included): the caller must stop fetching. */
export function spendBytes(n: number): boolean {
	if (sessionCap.tripped) return false;
	sessionCap.spent += n;
	if (sessionCap.spent > SESSION_BYTE_CAP) {
		sessionCap.tripped = true;
		console.error(`[session-byte-cap] ${(sessionCap.spent / 1048576).toFixed(1)} MB fetched; downloads stopped`);
	}
	return !sessionCap.tripped;
}
