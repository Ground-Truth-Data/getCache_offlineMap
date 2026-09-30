/**
 * Row counts for the tool on screen, so a CRUD pill can show whether there's
 * anything behind it before you click. A store, not a prop: AdminHeader takes
 * none by design (derives everything from the URL, keeping it pure nav), and
 * only the page with the database open can answer this cheaply.
 */
const counts = $state<{ v: Record<string, number> }>({ v: {} });

export const setTableCounts = (next: Record<string, number>) => {
	counts.v = next;
};

/** `undefined` = NOT COUNTED (no sweep run, or this tool doesn't). Only a real 0 means empty, so a pill can tell "nothing here" from "nobody looked". */
export const tableCount = (name: string): number | undefined => counts.v[name];
