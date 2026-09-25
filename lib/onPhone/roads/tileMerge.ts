/** Layer-level merge of MVT blobs sharing one z/x/y frame — not byte-concat: the MVT parser indexes layers by name and keeps only the last duplicate. Tags are index pairs into the tile's own tables, so they are re-indexed into the merged tables. */

function readVarint(buf: Uint8Array, pos: number): [number, number] {
	let result = 0;
	let shift = 0;
	let p = pos;
	for (;;) {
		const b = buf[p++];
		// * 2**shift, not <<: lengths can exceed 31 bits of headroom
		result += (b & 0x7f) * 2 ** shift;
		if ((b & 0x80) === 0) break;
		shift += 7;
	}
	return [result, p];
}

/** One growing Uint8Array; a `number[]` with a byte per push was a 290 MB spike per zoom change. */
class Writer {
	private buf: Uint8Array<ArrayBuffer>;
	private len = 0;

	constructor(capacity = 1 << 16) {
		this.buf = new Uint8Array(capacity);
	}

	private ensure(n: number): void {
		if (this.len + n <= this.buf.length) return;
		let cap = this.buf.length * 2;
		while (cap < this.len + n) cap *= 2;
		const next = new Uint8Array(cap);
		next.set(this.buf.subarray(0, this.len));
		this.buf = next;
	}

	varint(v: number): void {
		this.ensure(5);
		while (v > 0x7f) {
			this.buf[this.len++] = (v & 0x7f) | 0x80;
			v = Math.floor(v / 128);
		}
		this.buf[this.len++] = v;
	}

	bytes(b: Uint8Array): void {
		this.ensure(b.length);
		this.buf.set(b, this.len);
		this.len += b.length;
	}

	finish(): Uint8Array<ArrayBuffer> {
		return this.buf.slice(0, this.len);
	}
}

function varintLen(v: number): number {
	let n = 1;
	while (v > 0x7f) {
		v = Math.floor(v / 128);
		n++;
	}
	return n;
}

function writeVarintTo(buf: Uint8Array, pos: number, value: number): number {
	let v = value;
	let p = pos;
	while (v > 0x7f) {
		buf[p++] = (v & 0x7f) | 0x80;
		v = Math.floor(v / 128);
	}
	buf[p++] = v;
	return p - pos;
}

const DECODER = new TextDecoder();
const ENCODER = new TextEncoder();

function skipField(buf: Uint8Array, wire: number, pos: number): number {
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

function splitTile(data: Uint8Array): Uint8Array[] {
	const layers: Uint8Array[] = [];
	let p = 0;
	while (p < data.length) {
		let tag: number;
		[tag, p] = readVarint(data, p);
		const field = tag >>> 3;
		const wire = tag & 7;
		if (field === 3 && wire === 2) {
			let len: number;
			[len, p] = readVarint(data, p);
			layers.push(data.subarray(p, p + len));
			p += len;
		} else {
			p = skipField(data, wire, p);
		}
	}
	return layers;
}

interface LayerParts {
	name: string;
	/** Fields other than name/keys/values/features/extent, as raw segments. */
	header: Uint8Array[];
	features: Uint8Array[];
	keys: string[];
	/** Raw Value messages; they may be any scalar type. */
	values: Uint8Array[];
	extent: number;
}

function splitLayer(layer: Uint8Array): LayerParts {
	const header: Uint8Array[] = [];
	const features: Uint8Array[] = [];
	const keys: string[] = [];
	const values: Uint8Array[] = [];
	let name = "";
	let extent = 4096;
	let p = 0;
	while (p < layer.length) {
		const start = p;
		let tag: number;
		[tag, p] = readVarint(layer, p);
		const field = tag >>> 3;
		const wire = tag & 7;
		if (field === 2 && wire === 2) {
			let len: number;
			[len, p] = readVarint(layer, p);
			features.push(layer.subarray(p, p + len));
			p += len;
			continue;
		}
		if (field === 1 && wire === 2) {
			let len: number;
			[len, p] = readVarint(layer, p);
			name = DECODER.decode(layer.subarray(p, p + len));
			p += len;
			continue;
		}
		if (field === 3 && wire === 2) {
			let len: number;
			[len, p] = readVarint(layer, p);
			keys.push(DECODER.decode(layer.subarray(p, p + len)));
			p += len;
			continue;
		}
		if (field === 4 && wire === 2) {
			let len: number;
			[len, p] = readVarint(layer, p);
			values.push(layer.subarray(p, p + len));
			p += len;
			continue;
		}
		if (field === 5 && wire === 0) {
			const [v, after] = readVarint(layer, p);
			extent = v;
			p = after;
			continue;
		}
		const next = skipField(layer, wire, p);
		header.push(layer.subarray(start, next));
		p = next;
	}
	return { name, header, features, keys, values, extent };
}

function valueId(v: Uint8Array): string {
	let s = "";
	for (let i = 0; i < v.length; i++) s += String.fromCharCode(v[i]);
	return s;
}

/** Rewrite one feature's `tags` from the source tables into the merged tables. */
function remapTags(
	feature: Uint8Array,
	keyMap: number[],
	valMap: number[],
): Uint8Array {
	const spans: Array<{ start: number; end: number; indices: number[] }> = [];
	let p = 0;
	while (p < feature.length) {
		const start = p;
		let tag: number;
		[tag, p] = readVarint(feature, p);
		const field = tag >>> 3;
		const wire = tag & 7;
		if (field === 2 && wire === 2) {
			let len: number;
			[len, p] = readVarint(feature, p);
			const end = p + len;
			const indices: number[] = [];
			while (p < end) {
				let k: number;
				let v: number;
				[k, p] = readVarint(feature, p);
				[v, p] = readVarint(feature, p);
				indices.push(keyMap[k] ?? k, valMap[v] ?? v);
			}
			spans.push({ start, end, indices });
		} else {
			p = skipField(feature, wire, p);
		}
	}
	if (!spans.length) return feature;
	// The rewritten tag header is canonical: field 2, wire 2, one byte.
	let size = feature.length;
	for (const s of spans) {
		let bodyLen = 0;
		for (const n of s.indices) bodyLen += varintLen(n);
		size -= s.end - s.start;
		size += 1 + varintLen(bodyLen) + bodyLen;
	}
	const out = new Uint8Array(size);
	let w = 0;
	let r = 0;
	for (const s of spans) {
		out.set(feature.subarray(r, s.start), w);
		w += s.start - r;
		out[w++] = (2 << 3) | 2;
		let bodyLen = 0;
		for (const n of s.indices) bodyLen += varintLen(n);
		w += writeVarintTo(out, w, bodyLen);
		for (const n of s.indices) w += writeVarintTo(out, w, n);
		r = s.end;
	}
	out.set(feature.subarray(r), w);
	return out;
}

/** Merge same-address tiles into one: same-named layers fuse, order-independent. */
export function mergeSameFrameTiles(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
	const byName = new Map<
		string,
		{
			parts: LayerParts;
			keyIndex: Map<string, number>;
			valIndex: Map<string, number>;
		}
	>();

	for (const data of parts) {
		if (!data || data.byteLength === 0) continue;
		for (const raw of splitTile(data)) {
			const src = splitLayer(raw);
			let dst = byName.get(src.name);
			if (!dst) {
				dst = {
					parts: {
						name: src.name,
						header: src.header,
						features: [],
						keys: [],
						values: [],
						extent: src.extent,
					},
					keyIndex: new Map(),
					valIndex: new Map(),
				};
				byName.set(src.name, dst);
			}

			const keyMap: number[] = src.keys.map((k) => {
				let i = dst.keyIndex.get(k);
				if (i === undefined) {
					i = dst.parts.keys.length;
					dst.parts.keys.push(k);
					dst.keyIndex.set(k, i);
				}
				return i;
			});
			const valMap: number[] = src.values.map((v) => {
				const id = valueId(v);
				let i = dst.valIndex.get(id);
				if (i === undefined) {
					i = dst.parts.values.length;
					dst.parts.values.push(v);
					dst.valIndex.set(id, i);
				}
				return i;
			});
			for (const f of src.features) {
				dst.parts.features.push(remapTags(f, keyMap, valMap));
			}
		}
	}

	const out = new Writer();
	for (const layer of byName.values()) {
		if (!layer.parts.features.length) continue;
		const body = new Writer();
		const nameBytes = ENCODER.encode(layer.parts.name);
		body.varint((1 << 3) | 2);
		body.varint(nameBytes.length);
		body.bytes(nameBytes);
		for (const k of layer.parts.keys) {
			const kb = ENCODER.encode(k);
			body.varint((3 << 3) | 2);
			body.varint(kb.length);
			body.bytes(kb);
		}
		for (const v of layer.parts.values) {
			body.varint((4 << 3) | 2);
			body.varint(v.length);
			body.bytes(v);
		}
		for (const seg of layer.parts.header) body.bytes(seg);
		body.varint((5 << 3) | 0);
		body.varint(layer.parts.extent);
		for (const f of layer.parts.features) {
			body.varint((2 << 3) | 2);
			body.varint(f.length);
			body.bytes(f);
		}
		const bodyBytes = body.finish();
		out.varint((3 << 3) | 2);
		out.varint(bodyBytes.length);
		out.bytes(bodyBytes);
	}
	return out.finish();
}
