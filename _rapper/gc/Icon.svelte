<!-- The one inline line-icon component for the whole app — a named glyph
     from `iconPaths.ts` in a shared 24×24 viewBox, colour via currentColor.
     `class` won't reach this child svg through a parent's scoped CSS; use
     size/style for sizing instead. -->
<script lang="ts">
import { ICONS, type IconName } from "./iconPaths";

let {
	name,
	size = 24,
	stroke = undefined,
	fill = "none",
	class: cls = "",
	style = "",
	ariaLabel = undefined,
}: {
	name: IconName;
	size?: number;
	stroke?: number;
	fill?: string;
	class?: string;
	style?: string;
	ariaLabel?: string;
} = $props();

const def = $derived(ICONS[name]);
</script>

<svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    {fill}
    stroke="currentColor"
    stroke-width={stroke ?? def.sw}
    stroke-linecap="round"
    stroke-linejoin="round"
    class={cls}
    {style}
    role={ariaLabel ? "img" : undefined}
    aria-label={ariaLabel}
    aria-hidden={ariaLabel ? undefined : "true"}
>
    <!-- eslint-disable-next-line svelte/no-at-html-tags — static, in-repo icon markup -->
    {@html def.body}
</svg>
