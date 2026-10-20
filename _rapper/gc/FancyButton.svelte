<!-- THE fancy button. The material is `.rt-fancy-btn` in theme.css; this adds sizes, icon slot and press tracking. -->
<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
	size?: "xs" | "sm" | "md" | "lg";
	variant?: "gold" | "rust";
	/** Block CTAs fill their column; `false` hugs the label. */
	full?: boolean;
	disabled?: boolean;
	href?: string;
	type?: "button" | "submit";
	onclick?: (e: MouseEvent) => void;
	icon?: Snippet;
	children?: Snippet;
	ariaLabel?: string;
	title?: string;
	/** Layout only; style it with `:global(.x)` from the caller. */
	class?: string;
};

let {
	size = "md",
	variant = "gold",
	full = size !== "xs",
	disabled = false,
	href,
	type = "button",
	onclick,
	icon,
	children,
	ariaLabel,
	title,
	class: cls = "",
}: Props = $props();

let pressed = $state(false);
const press = () => (pressed = !disabled);
const release = () => (pressed = false);
</script>

{#snippet body()}
    {#if icon}<span class="badge">{@render icon()}</span>{/if}
    {#if children}<span>{@render children()}</span>{/if}
{/snippet}

<svelte:element
    this={href ? "a" : "button"}
    class="rt-fancy-btn fb size-{size} {cls}"
    class:rt-fancy-btn--rust={variant === "rust"}
    class:full
    class:pressed
    class:disabled={href && disabled}
    href={href && !disabled ? href : undefined}
    type={href ? undefined : type}
    disabled={href ? undefined : disabled}
    aria-disabled={href ? disabled : undefined}
    aria-label={ariaLabel}
    role={href ? "link" : "button"}
    {title}
    onpointerdown={press}
    onpointerup={release}
    onpointerleave={release}
    onpointercancel={release}
    onclick={disabled ? undefined : onclick}
>
    {@render body()}
</svelte:element>

<style>
    .full {
        width: 100%;
    }
    .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .size-xs {
        padding: 6px 14px;
        font-size: 0.82rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        border-radius: var(--rt-radius-sm);
        gap: 8px;
    }
    .size-xs .badge {
        width: 18px;
        height: 18px;
    }
    .size-sm {
        padding: 0.6rem 0.9rem;
        font-size: 0.9rem;
        border-radius: 0.6rem;
    }
    .size-sm .badge {
        width: 22px;
        height: 22px;
    }
    .size-md {
        padding: 0.7rem 1rem;
        font-size: 1.25rem;
    }
    .size-md .badge {
        width: 24px;
        height: 24px;
    }
    .size-lg {
        padding: 1.15rem 1.25rem;
        font-size: 1.25rem;
        border-radius: 1rem;
        gap: 14px;
    }
    .size-lg .badge {
        width: 32px;
        height: 32px;
    }
</style>
