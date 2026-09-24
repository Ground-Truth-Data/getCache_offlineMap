/**
 * ONE pass at a time, and NOTHING asked for is forgotten. `if (running) return
 * running` drops the new caller's keys; here keys arriving mid-pass are held
 * and run together as ONE follow-up pass, and their callers resolve when the
 * pass that actually covered them is done.
 */

/** Resolves with however many landed. */
export type PassRunner<K> = (keys: readonly K[]) => Promise<number>;

/** Keys must be primitives: they are deduped by identity in a Set. */
export function passQueue<K extends string | number>(
	run: PassRunner<K>,
): (keys: readonly K[]) => Promise<number> {
	let running: Promise<number> | null = null;
	let waiting = new Set<K>();
	let waitingDone: Promise<number> | null = null;

	function start(keys: readonly K[]): Promise<number> {
		const p = run(keys).finally(() => {
			running = null;
			// Drain BEFORE this promise settles, so an awaiter cannot observe an empty queue and conclude its keys were skipped.
			if (waiting.size > 0) {
				const next = [...waiting];
				waiting = new Set();
				waitingDone = null;
				// Nobody owns this pass, so a rejection would be unhandled; the next ask starts a fresh pass anyway.
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
		waitingDone ??= running.then(
			() => queued(),
			// The current pass failing says nothing about ours; its own caller saw the rejection.
			() => queued(),
		);
		return waitingDone;
	};

	function queued(): Promise<number> {
		return running ?? Promise.resolve(0);
	}
}
