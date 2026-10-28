// wrangler Data rule (wrangler.toml `rules`): a .bin import is the file's bytes.
declare module "*.bin" {
	const data: ArrayBuffer;
	export default data;
}

// Vite (vitest) only: a ?raw import is the file's text.
declare module "*?raw" {
	const text: string;
	export default text;
}
