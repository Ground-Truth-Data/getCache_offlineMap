# Field notes — 3 Sep 2026, first session on the merged direction2 work

For **Chris and DeepMoire** both. Chris drove the merged app (worker-local-dev,
then a real worker-cloud-dev deploy) and dropped pins around Virginia. The
direction2 line is merged onto main (`e27258c`) and the dev Worker is running
it. These are field observations, ordered by how much they bother Chris —
suggestions, not orders. Claim an item by putting your name on it; delete items
as they land (this file follows the TODO.md rule: done lines are deleted, never
checked off).

## 1. Ghost grid — MORE visible, and fuzzy

The 1% squares are too faint. Raise the opacity noticeably (start around 0.05
and eyeball from there — `wallStyle.ts` `v4-blob-grid-fill`, test asserts the
value per BRANCH_NOTES).

Two aesthetic notes from Chris:
- **The overlap blur is the best part** — where two pins' boxes overlap and the
  whites stack, it blurs together beautifully. Keep that additive look.
- **No crisp edges.** He'd rather the squares have soft/fuzzy edges than clean
  white rectangles. (MapLibre fill layers can't blur natively — likely a
  fill-extrusion trick, a pre-blurred sprite per box, or a cheap halo: a second,
  slightly larger box layer at lower opacity underneath.)

## 2. Satellite photos look blurrier than ever (z16)

Always a bit soft, but now "crazy blurry — really hard to see" when zoomed to
z16. Feels like a regression, though satellite wasn't touched in direction2
(`blobVersion` still says `sat2km`). Worth checking: is the photo painted
beyond its native resolution (a ~2 km photo stretched across z16), and did
anything change the raster's maxzoom/resampling? Compare an old bake vs a fresh
pv48 bake of the same spot before assuming.

## 3. Fires: red everywhere off prod

- On **worker-local-dev**: `/fires` returns 500 — no `FIRMS_MAP_KEY` locally.
  Fine if that's the accepted local story, but then the rail should say
  "no fire key locally", not a generic red err.
- On **worker-cloud-dev** (freshly deployed): fires still red for Chris. Check
  whether the dev Worker has the `FIRMS_MAP_KEY` secret set at all —
  `npx wrangler secret list --env dev`. Prod has it; dev may never have.

## 4. Hospitals have no pin-card

Hospital markers render, but tapping one shows no card/callout like other pins
get. Feature ask, not a bug. "Could be faster" too — hospitals rode the same
26s cloud-dev download as labels in Chris's session.

## 5. Download stopwatch: ~2 s of dead air before it counts

The dl badge sits at 0 for about two seconds after a pin drops, THEN starts
counting, and totals push 10 s. Two separate questions:
- What happens in those first ~2 s (queueing before the ask actually fires?
  the badge should start at the ASK, so either the ask is late or the badge is).
- Can the total come down. Session numbers from Chris's debug JSON: satellite
  transit 2.0 s, road pack 3.6 s on local — but the felt time pin→painted is
  ~10 s. The gap between "bytes landed" and "painted" was 5.7 s for the
  satellite (`paintLagMs: 5729`). The paint lag looks like the bigger fish.

## 6. Memory: ~800 MB peaks

Peak 806 MB main-thread (avg ~330 MB) during normal pin/zoom play. Ideas
floated, in Chris's words, roughly:
- draw/decode less at high zoom, truncate harder;
- make the spikes less spiky (the peak graph shows sharp bake-time spikes);
- **"throw it away like Google does"** — don't keep decoded tiles/images
  referenced in memory just because they're in the cache. IndexedDB IS the
  cache; memory should hold only what's on screen, and re-read from IDB on
  demand. If something isn't in the viewport, purge the decoded copy.
  (Direction2.2's in-memory key set is a *set of keys*, cheap — this is about
  decoded tile/image payloads.)

## 7. Process note

Chris isn't editing the same files while DeepMoire is moving fast — this doc is
the handoff channel. DeepMoire: work from `main` (the direction2 merge + a
small `workersLayout.test.ts` fix are on origin). The cloud-dev Worker is
deployed from that main; prod Worker still runs the pre-direction2 build,
deliberately, until dev has soaked.
