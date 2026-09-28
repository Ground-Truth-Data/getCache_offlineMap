<img width="120" align="right" alt="rapper" src="https://github.com/user-attachments/assets/53029e8e-815f-4fb2-8a35-b97e71beb84e" />

<br/>
<span/>


# rapper

**A thin SvelteKit shell** that runs any one of ReTreever and Get Cache's
component repos on its own. rapper itself carries almost nothing — the
components (children) live in their own repos:

- [getCache_OfflineMap](https://github.com/Ground-Truth-Data/getCache_OfflineMap)
- [getCache_OnlineMap](https://github.com/Ground-Truth-Data/getCache_OnlineMap)
- [ReTreever_who_what](https://github.com/Ground-Truth-Data/ReTreever_who_what)
- [ReTreever_where](https://github.com/Ground-Truth-Data/ReTreever_where)

## Get started

Clone the child you want. Each published child carries a copy of rapper as
`_rapper/` (and any companion child it needs as `_siblings/`), so the clone
is a complete app:

```bash
git clone https://github.com/Ground-Truth-Data/getCache_OfflineMap
cd getCache_OfflineMap
npm install
npm run dev
```

`_rapper/` is **generated** (by `dressChild.sh` in the private workspace) and
rewritten wholesale on every publish. Change rapper in this repo, never in a
child's copy.

### Environment

A hand-cloned rapper starts from `.env.example` (copy it to `rapper/.env`).
Nothing here is required by rapper itself — each variable belongs to a
component:

| Variable | Needed by | Unset means |
|---|---|---|
| `VITE_TILES_HOST` | `getCache_OfflineMap` | no tiles are downloaded; the satellite layer still draws, so it reads as "roads are broken" — the console says so on the first line |
| `VITE_MAPBOX_TOKEN` | `getCache_OnlineMap`, `ReTreever_where` | no map is created; the page says which variable is missing |

`.env.example` names Ground Truth's public, read-only tile hosts
(`tiles-prod.getcache.org`, `tiles-dev.getcache.org`) and shows how to run a
Worker locally with no cloud account. The component bakes in no host (its
`tierNaming.test.ts` fails if one appears), so a fork never inherits someone
else's bill. `VITE_MAPBOX_TOKEN` has no default — a token is billed to
whoever created it.

> The offline map's ~50 MB basemap is not in git; `npm run dev` downloads it
> on first run (`getCache_OfflineMap/fetchAssets.sh`). Without it the map
> renders blank and the BUILD fails outright (SvelteKit walks `static/` and
> dies on the dangling symlinks).

## How it works

A component is source code, not an app — a flat `lib/` + `routes/` folder with
no framework and no `node_modules`. It has nothing to `npm run dev` on its own;
rapper is what makes it runnable.

A dressed child serves its own `routes/` directly: `mounted.json` names the
component, and `svelte.config.js` derives `kit.files` (`routes/`, `params/`,
`hooks.ts`) from it, so there is one route tree and no forwarding pages to
drift. The git checkout of rapper is different: its own `src/routes/`
re-exports every component's pages at once, for developing them side by
side. The dev shell — logo, the component's name, one link per view — is
`rig/Layout.svelte`, rendered by the component's layout, and it only appears
in dev. Branding is rapper's job, never the component's: the owner name and
logo arrive as props, so a component names no product.

### Why the child is a SIBLING

`svelte.config.js` declares `"$parent/siblings": "../"`, so a child must sit
one level up from rapper. Nest it and `../` points at the wrong folder and
every import inside it fails. In the development workspace both parents and
every child are members of one npm workspace with one `node_modules`.

`rig/`, `gc/` and `rt/` are the shared tree, and THIS repo is its home —
ReTreever imports them from here through the same `$rig`/`$gc`/`$rt` aliases.
Nothing is copied. `src/app.unique.css` is the one per-tier file: it imports
`$gc/theme.css` and then the tokens the tiers disagree on, which is how a page
declares its tier.

rapper is a dev harness, not a deployment target. The ReTreever production
site ships through its own pipeline; nothing here is meant to deploy.

## The rules that keep a child liftable

The guards discover children by **shape** — any folder containing `lib/` and
`routes/` — so a new child is governed the day it is created.

1. **A child never names its parent.** Inside a child, imports are relative, or
   they go through an alias the parent fills in: `$parent`, `$parent/siblings`
   and the shared tree `$rig` / `$gc` / `$rt` — nothing else. A raw
   `../../rapper/…` climb NAMES rapper; `noEscapePlugin` throws on it.
2. **A child never imports another child** except where ReTreever's
   `childBoundary.test.ts` declares the edge (`DECLARED_CHILD_DEPS`). Two
   children that import each other freely are one child wearing two folders.
3. **A child never touches `$lib` / `$tinyStore` / `$mobRoutes`.** That is
   ReTreever's proprietary side.
4. **A child is SELF-CONTAINED.** There is no shared middle folder. A helper two
   children both need is duplicated in each.
5. **No relative path climbs out of the child.**

The build-time guards live in ReTreever — the only tier that can see both
sides — so a contributor cloning rapper does not receive them:

```bash
npx vitest run src/lib/core/harnessGuards/   # from the ReTreever repo
```

Each child also carries its own `lib/noParentNames.test.ts`, which runs in a
bare clone with `npm test`. If one goes red while you are moving code, it is
telling you the child just stopped being liftable. Fix the shape, do not
loosen the rule — and after touching a guard, plant a violation and watch it
fail.

### The real wall is an ABSENCE

Rule 3 is not a runtime check. It is `svelte.config.js` defining **no `$lib`
and no `$generated` alias**. A child that reaches for the private parent fails
to **build**, here, on your machine. Do NOT add `$lib` or `$generated` back to
make an import resolve — that is the one change that quietly re-couples a
child to code it will never ship with.

## Contributing

A component's code belongs to the component's repo — branch, push and open
the PR there. Changes to the shell itself (rig, gc, rt, config) go to
[rapper](https://github.com/Ground-Truth-Data/rapper). Clone the components
beside it, not inside it.
