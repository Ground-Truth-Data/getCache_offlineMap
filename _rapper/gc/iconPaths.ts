// THE inline line-icon catalog — one row per icon (`body` + canonical `sw`).
// <Icon> (same folder) wraps these in a 24×24 viewBox. Shared via
// $parent/siblings so ReTreever and the open map both read ONE catalog.
// Monochrome lucide-style only; bespoke/multi-colour marks stay inline.

export type IconDef = {
	/** Inner SVG markup (paths/polylines/circles), drawn in a 24×24 box. */
	body: string;
	/** The stroke width the icon was authored at. Overridable per call via
	 *  the <Icon stroke={…}> prop, but this is the faithful default. */
	sw: number;
};

export const ICONS = {
	// `edit` and `edit-tilt` are the SAME glyph — every edit affordance
	// app-wide renders this one path. Keep both names so existing call
	// sites don't churn; edit them HERE only.
	edit: {
		body: `<path d="M16.5 3.5l4 4L8 20l-5 1 1-5z"/><path d="M13.5 6.5l4 4"/>`,
		sw: 2,
	},
	"edit-tilt": {
		body: `<path d="M16.5 3.5l4 4L8 20l-5 1 1-5z"/><path d="M13.5 6.5l4 4"/>`,
		sw: 2,
	},
	close: { body: `<path d="M5 5l14 14M19 5L5 19"/>`, sw: 2.4 },
	undo: {
		body: `<path d="M9 7L4 11l5 4"/><path d="M4 11h9a5 5 0 015 5v2"/>`,
		sw: 2.4,
	},
	plus: { body: `<path d="M12 5v14M5 12h14"/>`, sw: 2.4 },
	ruler: {
		body: `<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>`,
		sw: 1.9,
	},

	layers: {
		body: `<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>`,
		sw: 1.9,
	},
	globe: {
		body: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 010 18"/><path d="M12 3a14 14 0 000 18"/>`,
		sw: 1.8,
	},
	navigation: { body: `<path d="M12 3l5 18-5-5-5 5z"/>`, sw: 2 },
	pentagon: { body: `<path d="M12 3l9 6-3.5 11h-11L3 9z"/>`, sw: 2.2 },
	"map-pin": {
		body: `<path d="M12 22s7-7.5 7-13a7 7 0 10-14 0c0 5.5 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/>`,
		sw: 2.2,
	},
	"share-nodes": {
		body: `<circle cx="6" cy="18" r="2.2" fill="currentColor"/><circle cx="18" cy="6" r="2.2" fill="currentColor"/><path d="M7.4 16.6L16.6 7.4"/>`,
		sw: 2.2,
	},
	grid: {
		body: `<path d="M3 3h18v18H3z"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>`,
		sw: 1.8,
	},
	basemap: {
		body: `<path d="M9 3v17M15 6v15M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z"/>`,
		sw: 1.8,
	},

	search: {
		body: `<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>`,
		sw: 2,
	},
	upload: {
		body: `<path d="M12 16V3M7 8l5-5 5 5"/><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>`,
		sw: 2,
	},
	download: {
		body: `<path d="M12 3v13M7 12l5 5 5-5"/><path d="M4 17v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>`,
		sw: 2.4,
	},
	trash: {
		body: `<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>`,
		sw: 2,
	},
	// Distinct drawing from `trash` — lidded can.
	"trash-2": {
		body: `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
		sw: 2.2,
	},
	share: {
		body: `<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>`,
		sw: 2.2,
	},
	copy: {
		body: `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`,
		sw: 2,
	},
	// HANDING a file over, distinct from `share`'s system share-sheet tray.
	send: {
		body: `<path d="m3 12 18-8-8 18-2-8z"/>`,
		sw: 2.2,
	},
	swap: {
		body: `<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>`,
		sw: 2.2,
	},
	folder: {
		body: `<path d="M3 7h6l2 2h10v10H3z"/>`,
		sw: 2.2,
	},
	warning: {
		body: `<path d="M12 9v5"/><path d="M12 17.5h.01"/><path d="M10.3 3.9 2.6 17.4A1.6 1.6 0 0 0 4 19.8h16a1.6 1.6 0 0 0 1.4-2.4L13.7 3.9a1.6 1.6 0 0 0-2.8 0Z"/>`,
		sw: 2.2,
	},
	// Filled dots — callers pass fill="currentColor".
	"dots-h": {
		body: `<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>`,
		sw: 0,
	},
	"log-out": {
		body: `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>`,
		sw: 2.4,
	},
	file: {
		body: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`,
		sw: 2,
	},
	list: {
		body: `<rect x="3" y="4" width="6" height="6" rx="1"/><rect x="3" y="14" width="6" height="6" rx="1"/><path d="M12 6h9"/><path d="M12 17h9"/>`,
		sw: 2,
	},

	check: { body: `<polyline points="20 6 9 17 4 12"/>`, sw: 2.4 },
	"check-bold": { body: `<path d="M5 12l5 5L20 7"/>`, sw: 3.5 },
	// A hair tighter than `close`'s corner-to-corner path; kept separate to
	// stay pixel-faithful.
	"close-x": {
		body: `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
		sw: 2.5,
	},
	menu: { body: `<path d="M3 5h18M6 12h12M10 19h4"/>`, sw: 2.4 },
	filter: {
		body: `<circle cx="17" cy="6" r="2.4"/><path d="M3 6h11.6"/><path d="M19.4 6H21"/><circle cx="7" cy="12" r="2.4"/><path d="M3 12h1.6"/><path d="M9.4 12H21"/><circle cx="12" cy="18" r="2.4"/><path d="M3 18h6.6"/><path d="M14.4 18H21"/>`,
		sw: 2,
	},
	info: {
		body: `<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>`,
		sw: 2.2,
	},
	legend: {
		body: `<path d="M5 2.5 2.3 6.7h5.4Z"/><path d="M2.3 9.9h5.4v4.2h-5.4Z"/><circle cx="5" cy="19.4" r="2.4"/><path d="M11 5.3h11"/><path d="M11 12h11"/><path d="M11 19.4h11"/>`,
		sw: 1.9,
	},
	users: {
		body: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
		sw: 2,
	},
	// Distinct from `file` (a document) and `grid` (a bare lattice) — this one
	// says "pictures". lucide `image`.
	image: {
		body: `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>`,
		sw: 2,
	},
	table: {
		body: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="M3 9h18"/><path d="M3 15h18"/>`,
		sw: 2,
	},
	// `grid` above is the map's graticule; this is a layout of cards.
	cards: {
		body: `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>`,
		sw: 2,
	},
	// A single closed path, which is why it reads cleanly at 13px where a
	// two-part wrench would muddy.
	wrench: {
		body: `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>`,
		sw: 2,
	},
	// Section-rail glyphs (the polygon/block card's one-row rail).
	"rail-note": {
		body: `<path d="M5 3.5h14v17H5z"/><path d="M8.5 8.5h7M8.5 12.5h7M8.5 16.5h4"/>`,
		sw: 1.9,
	},
	"rail-contacts": {
		body: `<circle cx="9.2" cy="8.4" r="3.3"/><path d="M3.4 19.6c0-3.1 2.6-5.4 5.8-5.4s5.8 2.3 5.8 5.4"/><circle cx="17.6" cy="9.6" r="2.4"/><path d="M16.2 14.4c2.5.3 4.4 2.2 4.4 4.6"/>`,
		sw: 1.9,
	},
	// Never a generic pentagon — the corners and contents are what make it
	// read as a block rather than "a polygon".
	"rail-block": {
		body: `<path d="M4.12 6.75 12.38 3l7.5 4.88-2.25 12.38-11.25 1.12z"/><circle cx="4.12" cy="6.75" r="1.27"/><circle cx="12.38" cy="3" r="1.27"/><circle cx="19.88" cy="7.88" r="1.27"/><circle cx="17.62" cy="20.25" r="1.27"/><circle cx="6.38" cy="21.38" r="1.27"/><path d="M14.25 9.75l-2.25 3.75h4.5z"/><path d="M14.25 13.5v2.25"/><ellipse cx="7.88" cy="14.25" rx="2.25" ry="1.12"/><path d="M5.62 14.25v1.88c0 .64 1.01 1.12 2.25 1.12s2.25-.49 2.25-1.12v-1.88"/>`,
		// Authored at 64×64 with sw 3.4; rescaled to this catalog's 24×24 box.
		sw: 1.28,
	},
	// Deliberately not a polygon-with-handles (collides with rail-block) or
	// a pencil (collides with rail-note).
	"rail-edit": {
		body: `<rect x="9" y="9" width="6" height="6" rx="1.4"/><path d="M12 2.6v3.6M12 17.8v3.6M2.6 12h3.6M17.8 12h3.6"/><path d="m9.8 4.6 2.2-2 2.2 2M9.8 19.4l2.2 2 2.2-2M4.6 9.8l-2 2.2 2 2.2M19.4 9.8l2 2.2-2 2.2"/>`,
		sw: 1.9,
	},

	eye: {
		body: `<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>`,
		sw: 2,
	},
	// A lowered lid with lashes, not a slashed eye — a slash reads as
	// "forbidden"; this is simply not being shown right now.
	"eye-closed": {
		body: `<path d="M2 11.5s4 5.5 10 5.5 10-5.5 10-5.5"/><line x1="4" y1="15.2" x2="2.6" y2="17.6"/><line x1="8" y1="17" x2="7.2" y2="19.6"/><line x1="12" y1="17.5" x2="12" y2="20.2"/><line x1="16" y1="17" x2="16.8" y2="19.6"/><line x1="20" y1="15.2" x2="21.4" y2="17.6"/>`,
		sw: 2,
	},

	"chevron-right": { body: `<polyline points="9 18 15 12 9 6"/>`, sw: 2 },
	"chevron-left": { body: `<polyline points="15 18 9 12 15 6"/>`, sw: 2.5 },
	"chevron-down": { body: `<polyline points="6 9 12 15 18 9"/>`, sw: 2.4 },
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;
