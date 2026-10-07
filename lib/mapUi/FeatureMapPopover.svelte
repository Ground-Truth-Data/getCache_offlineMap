<!-- FeatureMapPopover — absolute-positioned popover that floats over the Mapbox container near a selected feature. Owns positioning + the popover surface; defers all content to FeatureDetail. -->
<script lang="ts">
import type { Feature } from "geojson";
import MapPopoverShell from "../panels/MapPopoverShell.svelte";
import type { BlockPick, MapHostPorts, MapShareFormat } from "../shared/mapHostPorts";

let {
    ports,
    map,
    feature,
    bbox,
    containerWidth,
    containerHeight,
    onShare,
    onSave,
    onClose,
    onChangeIcon,
    onTitleShown,
    onDelete,
    onContacts,
    onBlock,
    cornerEditing = false,
    onEditCorners,
    drawLive = false,
}: {
    ports: MapHostPorts;
    /** The map this floats over, handed to the host so it can capture it. */
    map?: unknown;
    feature: Feature;
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
    containerWidth: number;
    containerHeight: number;
    onShare: (format: MapShareFormat) => void;
    onSave: (name: string, featureDesc: string, featureData: string) => void;
    onClose: () => void;
    onChangeIcon?: (key: string) => void;
    /** Show or hide this polygon's name on the map. */
    onTitleShown?: (v: boolean) => void;
    onDelete?: () => void;
    onContacts?: (keys: string[]) => void;
    onBlock?: (pick: BlockPick) => void;
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
        {map}
        {feature}
        {onShare}
        {onSave}
        {onClose}
        {onChangeIcon}
        {onTitleShown}
        {onDelete}
        {onContacts}
        {onBlock}
        {cornerEditing}
        {onEditCorners}
    />
</MapPopoverShell>
