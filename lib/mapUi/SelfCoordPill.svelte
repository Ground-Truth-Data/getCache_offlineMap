<script lang="ts">
import type { Map as MapboxMap } from "mapbox-gl";
import type { MapHostPorts, MapShareRow as ShareFormat } from "../shared/mapHostPorts";

type Props = {
    ports: MapHostPorts;
    map: MapboxMap | null;
    coord: { lng: number; lat: number } | null;
    /** Built by the host, keeping the pill presentational. */
    formats: ShareFormat[];
    /** No ✕ on the chip; a map tap dismisses. */
    onClose?: () => void;
};

let { ports, map, coord, formats, onClose }: Props = $props();

let pos = $state<{ x: number; y: number } | null>(null);

function computePos(): void {
    if (!map || !coord) {
        pos = null;
        return;
    }
    // A degenerate camera can project to NaN; hide rather than translate(NaN,NaN).
    const p = map.project([coord.lng, coord.lat]);
    pos = Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
}

$effect(() => {
    if (!map || !coord) {
        pos = null;
        return;
    }
    computePos();
    const onMove = () => computePos();
    const onMapClick = () => onClose?.();
    map.on("move", onMove);
    map.on("click", onMapClick);
    return () => {
        map?.off("move", onMove);
        map?.off("click", onMapClick);
    };
});

// 3 dp ≈ 110 m keeps the pill narrow; share rows carry full precision.
const readout = $derived(
    coord ? `${coord.lat.toFixed(3)}°, ${coord.lng.toFixed(3)}°` : "",
);
</script>

{#if coord && pos}
    <!-- Shared .rt-line-label globals, deliberately not restyled, so it never drifts from the ruler's chip. -->
    <div
        class="rt-line-label rt-line-label-total rt-selfcoord"
        style="--x:{pos.x}px; --y:{pos.y}px"
        role="status"
        aria-live="polite"
    >
        {readout}

        <ports.ui.SharePicker {formats} side="above">
            {#snippet trigger({ toggle }: { toggle: () => void })}
                <button
                    class="rt-selfcoord__btn"
                    onclick={toggle}
                    aria-label="Share your GPS location"
                    title="Share your GPS location"
                >
                    <ports.ui.Icon name="share" size={16} />
                </button>
            {/snippet}
        </ports.ui.SharePicker>
    </div>
{/if}

<style>
/* POSITIONING ONLY — visuals live in mobile.css. The base sets pointer-events:none; re-enabled for the button. */
.rt-selfcoord {
    position: absolute;
    left: 0;
    top: 0;
    /* -50% centres on the dot; the lift clears the dot's own ring. */
    transform: translate(calc(var(--x) - 50%), calc(var(--y) - 34px));
    display: inline-flex;
    align-items: center;
    gap: 6px;
    pointer-events: auto;
    z-index: 5;
}

/* Taller than the 14px chip so the share button isn't missed as a speck. */
.rt-selfcoord__btn {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    /* Break out of the 14px line, top and bottom, without growing the pill. */
    margin: -7px -6px -7px 1px;
    border: 2px solid var(--rt-bg, #1a1a1a);
    border-radius: 50%;
    background: var(--rt-yellow, #ffd700);
    box-shadow: 0 2px 5px rgb(0 0 0 / 35%);
    color: inherit;
    cursor: pointer;
    flex: 0 0 auto;
}
.rt-selfcoord__btn:active {
    transform: scale(0.92);
}
</style>
