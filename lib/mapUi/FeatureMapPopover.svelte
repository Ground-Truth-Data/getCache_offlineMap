<!-- FeatureMapPopover — absolute-positioned popover that floats over the Mapbox container near a selected feature. Owns positioning + the popover surface; defers all content to FeatureDetail. -->
<script lang="ts">
import type { Feature } from "geojson";
import MapPopoverShell from "../panels/MapPopoverShell.svelte";
import type { MapHostPorts, MapShareFormat } from "../shared/mapHostPorts";

let {
    ports,
    feature,
    bbox,
    containerWidth,
    containerHeight,
    onShare,
    onSave,
    onClose,
    onChangeIcon,
    onFillOpacity,
    onTitleShown,
    onDelete,
    onContacts,
    onBlock,
    cornerEditing = false,
    onEditCorners,
    drawLive = false,
}: {
    ports: MapHostPorts;
    feature: Feature;
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
    containerWidth: number;
    containerHeight: number;
    onShare: (format: MapShareFormat) => void;
    onSave: (name: string, featureDesc: string, featureData: string) => void;
    onClose: () => void;
    onChangeIcon?: (key: string) => void;
    onFillOpacity?: (v: number) => void;
    /** Show or hide this polygon's name on the map. */
    onTitleShown?: (v: boolean) => void;
    onDelete?: () => void;
    onContacts?: (keys: string[]) => void;
    onBlock?: (block: string) => void;
    /** True while this feature's corners are in drag mode on the map. */
    cornerEditing?: boolean;
    onEditCorners?: (on: boolean) => void;
    /** A draw is in progress — the shell fades and yields taps to it. */
    drawLive?: boolean;
} = $props();

const isPoint = $derived(feature.geometry?.type === "Point");
</script>

<MapPopoverShell {bbox} {containerWidth} {containerHeight} {isPoint} {drawLive}>
    <!-- Pins/lines/polygons get an easy delete (garbage can beside Share); PLOT pins use their own popover and intentionally have no trash. -->
    <ports.ui.FeatureDetail
        {feature}
        {onShare}
        {onSave}
        {onClose}
        {onChangeIcon}
        {onFillOpacity}
        {onTitleShown}
        {onDelete}
        {onContacts}
        {onBlock}
        {cornerEditing}
        {onEditCorners}
    />
</MapPopoverShell>
