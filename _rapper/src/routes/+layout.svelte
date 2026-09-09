<script lang="ts">
/**
 * RAPPER'S OWN ROUTE TREE — every child at once, in the same two route groups
 * ReTreever uses: (rt) for the ReTreever children, (gc) for the phone ones.
 * Each page here is a one-line re-export of the child's own routes/ page, so
 * the child's file is the only copy of anything.
 *
 * A scaffold from `npm create` never builds this tree: the installer points
 * kit.files at ONE child's routes/ and deletes src/routes, src/params and
 * src/hooks.ts from the copy (rapper_director/bin/create.mjs).
 */
import Layout from "$rig/Layout.svelte";
import { childByRepo, childForPath } from "$rig/childRegistry";
import { page } from "$app/state";
import rtLogo from "$rt/assets/ReTreever_logo_sm.webp";
import gcLogo from "$gc/assets/GC_fly_logo_transparent.webp";
import gcIcon from "$gc/assets/favicon.png";
import rapperLogo from "$rig/assets/rapper.webp";

// The registry names logos as bare files so either parent can resolve them; this is rapper's resolution.
const LOGOS: Record<string, string> = {
	"ReTreever_logo_sm.webp": rtLogo,
	"GC_fly_logo_transparent.webp": gcLogo,
	"favicon.png": gcIcon,
	"rapper.webp": rapperLogo,
};

let { children } = $props();

const rec = $derived(childForPath(page.url.pathname) ?? childByRepo("rapper")!);
const child = $derived({ name: rec.name, owner: rec.owner, repo: rec.repo, views: rec.views });
const logo = $derived(LOGOS[rec.logo] ?? rapperLogo);
const icon = $derived(rec.icon ? LOGOS[rec.icon] : undefined);
</script>

<Layout {child} {logo} {icon}>
	{@render children()}
</Layout>
