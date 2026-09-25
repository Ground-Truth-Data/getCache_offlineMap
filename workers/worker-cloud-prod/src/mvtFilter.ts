export function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  let p = pos;
  for (;;) {
    const b = buf[p++];
    result += (b & 0x7f) * 2 ** shift; // not <<: lengths can exceed 31 bits
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [result, p];
}
export function writeVarint(out: number[], value: number): void {
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}
export function skipField(buf: Uint8Array, wire: number, pos: number): number {
  let p = pos;
  if (wire === 0) [, p] = readVarint(buf, p);
  else if (wire === 2) {
    let len: number;
    [len, p] = readVarint(buf, p);
    p += len;
  } else if (wire === 5) p += 4;
  else if (wire === 1) p += 8;
  return p;
}
export function layerName(layer: Uint8Array): string {
  let p = 0;
  while (p < layer.length) {
    let tag: number;
    [tag, p] = readVarint(layer, p);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) {
      let len: number;
      [len, p] = readVarint(layer, p);
      return new TextDecoder().decode(layer.subarray(p, p + len));
    }
    p = skipField(layer, wire, p);
  }
  return "";
}

import { PACK_LAYERS } from "./packLayers";

/** The attribute key to match and the values that survive. A rule names its key
 *  because Protomaps v4 files city/town/village under `kind_detail`, not `kind`. */
export interface KindRule {
  key: string;
  kinds: ReadonlySet<string>;
}
/** A bare Set is shorthand for `{ key: "kind", kinds }`. */
export type KindAllowlist = Record<string, ReadonlySet<string> | KindRule>;

/** Derive the wire-level allowlist from a contract rule table so the two cannot drift. */
export function allowlistOf(
  rules: Readonly<Record<string, { readonly key?: string; readonly kinds?: readonly string[] }>>,
): KindAllowlist {
  return Object.fromEntries(
    Object.entries(rules)
      .filter(([, r]) => r.kinds)
      .map(([name, r]) => [name, { key: r.key ?? "kind", kinds: new Set(r.kinds!) }]),
  );
}

export const KIND_ALLOWLIST: KindAllowlist = allowlistOf(PACK_LAYERS);

function ruleOf(entry: ReadonlySet<string> | KindRule): KindRule {
  return entry instanceof Set ? { key: "kind", kinds: entry } : (entry as KindRule);
}

/** Non-string Values yield "" (never a kind). */
function layerStringValues(layer: Uint8Array): string[] {
  const values: string[] = [];
  let p = 0;
  while (p < layer.length) {
    let tag: number;
    [tag, p] = readVarint(layer, p);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 4 && wire === 2) {
      let len: number;
      [len, p] = readVarint(layer, p);
      const value = layer.subarray(p, p + len);
      p += len;
      let vp = 0;
      let s = "";
      while (vp < value.length) {
        let vtag: number;
        [vtag, vp] = readVarint(value, vp);
        const vfield = vtag >>> 3;
        const vwire = vtag & 7;
        if (vfield === 1 && vwire === 2) {
          let vlen: number;
          [vlen, vp] = readVarint(value, vp);
          s = new TextDecoder().decode(value.subarray(vp, vp + vlen));
          vp += vlen;
        } else {
          vp = skipField(value, vwire, vp);
        }
      }
      values.push(s);
    } else {
      p = skipField(layer, wire, p);
    }
  }
  return values;
}

function kindKeyIndex(layer: Uint8Array, key = "kind"): number {
  let p = 0;
  let idx = 0;
  while (p < layer.length) {
    let tag: number;
    [tag, p] = readVarint(layer, p);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 3 && wire === 2) {
      let len: number;
      [len, p] = readVarint(layer, p);
      const k = new TextDecoder().decode(layer.subarray(p, p + len));
      p += len;
      if (k === key) return idx;
      idx++;
    } else {
      p = skipField(layer, wire, p);
    }
  }
  return -1;
}

function featureKindValueIndex(feature: Uint8Array, kindKeyIdx: number): number {
  let p = 0;
  while (p < feature.length) {
    let tag: number;
    [tag, p] = readVarint(feature, p);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 2 && wire === 2) {
      let len: number;
      [len, p] = readVarint(feature, p);
      const end = p + len;
      while (p < end) {
        let keyIdx: number;
        let valIdx: number;
        [keyIdx, p] = readVarint(feature, p);
        [valIdx, p] = readVarint(feature, p);
        if (keyIdx === kindKeyIdx) return valIdx;
      }
      return -1;
    }
    p = skipField(feature, wire, p);
  }
  return -1;
}

/** Keep only features whose `key` value is in `kinds`. A layer without the key
 *  is returned unchanged rather than emptied. */
export function filterLayerFeaturesByKind(
  layer: Uint8Array,
  kinds: ReadonlySet<string>,
  key = "kind",
): Uint8Array {
  const kindKeyIdx = kindKeyIndex(layer, key);
  if (kindKeyIdx < 0) return layer;
  const values = layerStringValues(layer);
  const wantedValueIdx = new Set<number>();
  for (let i = 0; i < values.length; i++) if (kinds.has(values[i])) wantedValueIdx.add(i);

  const out: number[] = [];
  let p = 0;
  while (p < layer.length) {
    const fieldStart = p;
    let tag: number;
    [tag, p] = readVarint(layer, p);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 2 && wire === 2) {
      let len: number;
      [len, p] = readVarint(layer, p);
      const feature = layer.subarray(p, p + len);
      const featureEnd = p + len;
      p = featureEnd;
      const valIdx = featureKindValueIndex(feature, kindKeyIdx);
      if (valIdx >= 0 && wantedValueIdx.has(valIdx)) {
        for (let i = fieldStart; i < featureEnd; i++) out.push(layer[i]);
      }
    } else {
      const next = skipField(layer, wire, p);
      for (let i = fieldStart; i < next; i++) out.push(layer[i]);
      p = next;
    }
  }
  return new Uint8Array(out);
}

/** Keep only the layers named in `keep`, kind-filtered where the allowlist has a rule. */
export function filterMvtToLayers(
  data: ArrayBuffer,
  keep: ReadonlySet<string>,
  allowlist: KindAllowlist = KIND_ALLOWLIST,
): ArrayBuffer {
  const buf = new Uint8Array(data);
  const out: number[] = [];
  let p = 0;
  while (p < buf.length) {
    let tag: number;
    [tag, p] = readVarint(buf, p);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 3 && wire === 2) {
      let len: number;
      [len, p] = readVarint(buf, p);
      const layer = buf.subarray(p, p + len);
      p += len;
      const name = layerName(layer);
      if (!keep.has(name)) continue;

      let layerBytes: Uint8Array = layer;
      if (allowlist[name]) {
        const rule = ruleOf(allowlist[name]);
        layerBytes = filterLayerFeaturesByKind(layer, rule.kinds, rule.key);
      }

      writeVarint(out, tag);
      writeVarint(out, layerBytes.length);
      for (let i = 0; i < layerBytes.length; i++) out.push(layerBytes[i]);
    } else {
      p = skipField(buf, wire, p);
    }
  }
  return new Uint8Array(out).buffer;
}
