<!-- FeatureMapPopover — absolute-positioned popover that floats over the Mapbox container near a selected feature. Owns positioning + the popover surface; defers all content to FeatureDetail. -->
<script lang="ts">
import type { Feature } from "geojson";
import MapPopoverShell from "../panels/MapPopoverShell.svelte";
import type { BlockPick, MapHostPorts, MapShareFormat } from "../shared/mapHostPorts";
import { canRoute, directionsTo } from "../route/routeLayer";
import { m } from "$parent/src/lib/paraglide/messages";

let {
    ports,
    map,
    feature,
    bbox,
    containerWidth,
    containerHeight,
    onShare,
    onSave,
    onChangeIcon,
    onContacts,
    onBlock,
    cornerEditing = false,
    onEditCorners,
    onDirections,
}: {
    ports: MapHostPorts;
    /** The map this floats over, handed to the host so it can capture it. */
    map?: unknown;
    feature: Feature;
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
    containerWidth: number;
    containerHeight: number;
    onShare: (format: MapShareFormat) => void;
    onSave: (name: string, featureDesc: string, featureDataJson: string) => void;
    onChangeIcon?: (key: string) => void;
    onContacts?: (keys: string[]) => void;
    onBlock?: (pick: BlockPick) => void;
    /** True while this feature's corners are in drag mode on the map. */
    cornerEditing?: boolean;
    onEditCorners?: (on: boolean) => void;
    /** After Directions starts — the host closes the popover so the route shows. */
    onDirections?: () => void;
} = $props();

const isPoint = $derived(feature.geometry?.type === "Point");
const pinAt = $derived(feature.geometry?.type === "Point" ? (feature.geometry.coordinates as [number, number]) : null);
</script>

<MapPopoverShell {bbox} {containerWidth} {containerHeight} {isPoint}>
    <ports.ui.FeatureDetail
        {map}
        {feature}
        {onShare}
        {onSave}
        {onChangeIcon}
        {onContacts}
        {onBlock}
        {cornerEditing}
        {onEditCorners}
    />
    {#if pinAt && canRoute()}
        <button type="button" class="rt-feature-directions rt-directions" onclick={() => {
            if (pinAt) directionsTo(pinAt);
            onDirections?.();
        }}>
            {m.ofmap_route_directions()}
        </button>
    {/if}
</MapPopoverShell>
