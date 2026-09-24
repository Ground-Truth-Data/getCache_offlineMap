/**
 * Which readers still owe a bypassed fetch for the current arrival. Per reader, not one flag:
 * a shared flag let one reader's tick eat the other's refresh.
 */
const owing = new Set<string>();

export type FireReader = "bake" | "map";
const READERS: readonly FireReader[] = ["bake", "map"];

export function noteFireArrival(): void {
	for (const r of READERS) owing.add(r);
}

/** Consumes: a skipped pass must not leave the debt standing, or every tick refetches forever. */
export function takeFireArrival(reader: FireReader): boolean {
	return owing.delete(reader);
}

/** Peeks: the caller has racing call sites, so only `settleFireArrival` clears the debt, after a fetch is attempted. */
export function peekFireArrival(reader: FireReader): boolean {
	return owing.has(reader);
}

export function settleFireArrival(reader: FireReader): void {
	owing.delete(reader);
}

export function resetFireArrival(): void {
	owing.clear();
}
