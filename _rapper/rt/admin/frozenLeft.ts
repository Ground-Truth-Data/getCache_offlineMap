/**
 * `position: sticky` needs each frozen cell's `left` as a LENGTH — the sum of
 * the widths before it, which only the browser knows after layout — so the
 * widths are measured from the first header row and written back as
 * `--fz0…--fzN` on the table. Re-measures rather than computing once: a
 * column can be drag-resized, the header can re-render with different
 * columns, a font can load late.
 */
export function frozenLeft(table: HTMLTableElement, count: number) {
	let n = count;

	// A FUNCTION, not a captured list: column reorder/re-render REPLACE the <th> nodes, or offsets freeze at stale values.
	const cells = () =>
		Array.from(
			table.querySelectorAll<HTMLElement>("thead tr:first-child > th"),
		).slice(0, n);

	const apply = () => {
		// getBoundingClientRect is post-zoom but `left` is read pre-zoom; under CSS
		// `zoom` the unscaled offsets open gaps the scrolling columns show through.
		const scale = table.offsetWidth / table.getBoundingClientRect().width || 1;
		let x = 0;
		cells().forEach((c, i) => {
			table.style.setProperty(`--fz${i}`, `${x}px`);
			x += c.getBoundingClientRect().width * scale;
		});
	};

	const ro = new ResizeObserver(apply);
	const watch = () => {
		ro.disconnect();
		for (const c of cells()) ro.observe(c);
		apply();
	};
	// Re-attaches the observer to the NEW nodes on any header re-render.
	const mo = new MutationObserver(watch);

	watch();
	if (table.tHead) mo.observe(table.tHead, { childList: true, subtree: true });

	return {
		update(next: number) {
			n = next;
			watch();
		},
		destroy() {
			ro.disconnect();
			mo.disconnect();
		},
	};
}
