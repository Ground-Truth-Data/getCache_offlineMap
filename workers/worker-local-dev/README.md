# offline-tiles — range-serve the planet from R2

A Cloudflare Worker that turns one Protomaps **planet `.pmtiles`** archive on
**R2** into what the offline map downloads. Self-contained: own `package.json`
and `node_modules`, touches nothing above this folder.

```
GET /{z}/{x}/{y}.pbf      one MVT tile (range reads into planet.pmtiles)
GET /pack?lng=&lat=       every tile for one pin's area, packed into ONE response
GET /fires?lng=&lat=&km=  NASA FIRMS hotspots for one disc — proxied so MAP_KEY stays server-side
GET /hospitals?lng=&lat=&km=  WORLD hospitals within km (default 200, max 500) of a point, from the pack bundled in the Worker; X-Radius-Km says what was served
```

- Tiles are served gunzipped (raw protobuf); a missing tile is `204`, not 404,
  so the renderer overzooms cleanly. CORS is open, `OPTIONS` handled.
- Which Worker the app talks to (prod / dev / local) is the client's business:
  `../lib/worker/README.md`.

## Run it locally

```bash
npx wrangler login    # once — or export CLOUDFLARE_API_TOKEN (R2 read is enough)
npm install
npm run dev           # the Worker runs here, on :8787, reading the REAL planet.pmtiles in R2
```

There is no local copy of the data and no sample extract: the bucket binding
is `remote = true` in `wrangler.toml`, so a local run answers exactly what
prod answers. Pick `worker-local-dev` in the map's CONFIG panel.

## Deploy

```bash
npx wrangler login    # once
npm run deploy:dev    # → tiles-dev.getcache.org, no prompt; break this one freely
npm run deploy        # → tiles-prod.getcache.org, asks for confirmation — every shipped phone reads it
```

⛔ Never create `tiles-prod` / `tiles-dev` DNS records by hand — `wrangler.toml`
marks them `custom_domain = true`, the deploy provisions DNS + TLS itself and
fails (100117) if a record already exists. Scope a contractor's API token to
the dev Worker; Cloudflare then enforces the prod/dev split.

## Park the planet (once)

1. Download a dated build from https://maps.protomaps.com/builds/ (~120 GB).
2. `npx wrangler r2 bucket create offline-tiles`
3. Upload with rclone (resumable; R2 ingress is free):
   ```bash
   rclone copy 20260601.pmtiles r2:offline-tiles/planet.pmtiles --progress
   ```
4. ⚠️ The object key must equal `PMTILES_KEY` / `PACK_PMTILES_KEY` in
   `wrangler.toml` — a mismatch reads as "no tiles", no error.

## The three folders

Edit only here. `../worker-cloud-dev/` and `../worker-cloud-prod/` are the
copies that match what `tiles-dev` and `tiles-prod` are running: their deploy
scripts sync this folder into them, then deploy. A cloud folder differing from
this one means "not deployed yet" — that gap is its whole message. Never
delete or merge them (`lib/worker/workerEnvironments.test.ts` fails).

## Cost

~120 GB × $0.015/GB-mo ≈ **$1.80/month** storage; R2 egress is $0; reads sit
under the free tier. Set a billing alert (~$15/mo) and stop optimising it. To
stop the bill: `npx wrangler r2 bucket delete offline-tiles`.
