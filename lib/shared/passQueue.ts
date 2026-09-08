/**
 * ONE pass at a time, and NOTHING asked for is forgotten.
 *
 * Every background pass on this map — satellite photos, fire discs, hospital
 * discs — wants the same two things at once: never two passes hitting the
 * endpoint together, and never a dropped ask. The obvious latch gets the first
 * and quietly loses the second:
 *
 *     if (running) return running;   // the caller's centres are thrown away
 *
 * That returns a promise for work the new centres are NOT part of, so the
 * caller is told "done" about something that never ran. Two pins dropped in
 * the same second means the second pin waits for whatever retry timer happens
 * to sweep it up.
 *
 * Here the ask is remembered instead: keys that arrive mid-pass are held, then
 * run together as ONE follow-up pass when the current one finishes. Callers
 * awaiting those keys resolve when the pass that actually covered them is done.
 */

/** Runs one pass over `keys`; resolves with however many landed. */
export type PassRunner<K> = (keys: readonly K[]) => Promise<number>;

/**
 * Wrap a pass so concurrent asks queue instead of vanishing.
 *
 * ⚠️ Keys must be primitives — they are deduped by identity in a Set, so a
 * fresh `[lng, lat]` array would never match an equal one. Pass a string key.
 */
export function passQueue<K extends string | number>(
	run: PassRunner<K>,
): (keys: readonly K[]) => Promise<number> {
	let running: Promise<number> | null = null;
	// The asks that arrived mid-pass, deduped: one turn each however many times asked.
	let waiting = new Set<K>();
	let waitingDone: Promise<number> | null = null;

	function start(keys: readonly K[]): Promise<number> {
		const p = run(keys).finally(() => {
			running = null;
			// Drain BEFORE this promise settles for its awaiters, so a caller who
			// awaits the queued pass cannot observe an empty queue and conclude
			// its keys were skipped.
			if (waiting.size > 0) {
				const next = [...waiting];
				waiting = new Set();
				waitingDone = null;
				// NOBODY OWNS THIS PASS. The queue starts it, not a caller, so a
				// rejection here has no handler anywhere and surfaces as an
				// unhandled rejection — WebKit reported it as an uncaught
				// "NetworkError: A network error occurred" whenever the tiles
				// Worker was unreachable. `waitingDone` does not cover it: that
				// chain belongs to callers who were already waiting, and the
				// drain outlives them.
				//
				// A failed background pass is not an error the app can act on —
				// the next ask starts a fresh pass — so it is logged, never
				// rethrown. Logged, not swallowed: silence here is what made the
				// original failure invisible.
				start(next).catch((e) => {
					console.warn("[passQueue] queued pass failed", e);
				});
			}
		});
		running = p;
		return p;
	}

	return (keys) => {
		if (keys.length === 0) return Promise.resolve(0);
		if (!running) return start(keys);
		for (const k of keys) waiting.add(k);
		// All asks that queue behind one pass share its follow-up: one pass, one promise.
		waitingDone ??= running.then(
			() => queued(),
			// The current pass failing says nothing about ours — its own caller
			// already saw the rejection, and swallowing it here would hide the
			// queued work behind an error that is not about it.
			() => queued(),
		);
		return waitingDone;
	};

	/** The follow-up pass `running`'s drain started, or a settled 0 if it already finished. */
	function queued(): Promise<number> {
		return running ?? Promise.resolve(0);
	}
}
