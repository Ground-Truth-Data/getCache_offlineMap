# Contributing to rapper

## The two tiers

```
rapper       THIS REPO. A thin SvelteKit app that mounts the children.
  └── child  a flat  lib/ + routes/  folder, sitting BESIDE rapper.
```

## Getting a child

A child is its own repository. It is not inside this one — `src/lib/` holds
only rapper's own `guards/noEscapePlugin.ts`.

One command sets up a project around a child:

```bash
npm create @retreever/rapper my-tool
```

It asks which component you want, then writes the project around that answer.
What lands on disk is a flat pair of folders:

```
my-tool/
├── package.json            <- deps installed HERE, at the root
├── rapper/                 <- the parent
└── getCache_OfflineMap/    <- the child, SIBLING of rapper
```

**One scaffold, one child.** An `npm create` install mounts one child: its
`svelte.config.js` `kit.files` names that child's `routes/`, `params/` and
`hooks.ts`, so the config always answers "what is mounted here?" honestly. (The
workspace checkout is different — see "The shell" below.)

The mounted child answers on its own routes, which are not always `/` — the
offline map serves `/offline` (its `hooks.ts` reroutes `/` there). The debug
rails are a toggle on that page, not a second URL.

### Why the child is a SIBLING, and why the install is at the root

The adjacency is not a stylistic choice — it is what the alias resolves against.
`svelte.config.js` declares `"$parent/siblings": "../"`, so the child must sit
one level up from rapper. Nest it and `../` points at the wrong folder and every
import inside it fails.

That layout then decides where `node_modules` has to go. **Install at the
project root — never inside `rapper/`.** The root is an npm **workspace** whose
members are `rapper` and the child: `npm install` there hoists every dependency
once, and Node resolves a bare specifier by walking UP from the importing file
to that one `node_modules` — exactly the role `fetch/` plays in the development
workspace, where both parents and every child are members. Each member declares
its own dependencies; there is no merging step, and `dedupe` is not needed when
there is one copy.

### The offline map needs ~50 MB of assets first

Basemap tiles, glyphs and demo imagery are **not in git** — too big, and not
AGPL. Without them the map renders blank and the BUILD fails outright
(SvelteKit walks `static/` and dies on the dangling symlinks).

```bash
getCache_OfflineMap/fetchAssets.sh
```

Runs on the first `npm run dev`; copies the basemap from a ReTreever checkout
beside it if there is one, otherwise downloads it from the child's GitHub
release.

## The rules that keep a child liftable

The guards discover children by **shape** — any folder containing a `lib/` — so
a new child is governed the day it is created, whoever owns it.

1. **A child never names its parent.** Inside a child, imports are relative, or
   they go through an alias the parent fills in. rapper defines `$parent`,
   `$parent/siblings` and the shared tree `$rig` / `$gc` / `$rt` — and nothing
   else. A raw `../../rapper/…` climb NAMES rapper, so the ReTreever side dies
   and the switch with it; `noEscapePlugin` throws on it.
2. **A child never imports another child** except where its own `deps.json`
   declares it. Two children that import each other freely are one child wearing
   two folders. The declared exception is read, never guessed: `ReTreever_where`
   declares two modules from `getCache_OnlineMap`, so the installer copies that
   companion in beside it — present to satisfy imports, not mounted.
3. **A child never touches `$lib` / `$tinyStore` / `$mobRoutes`.** That is
   ReTreever's proprietary side.
4. **A child is SELF-CONTAINED.** There is no shared middle folder. A helper two
   children both need is duplicated in each: a published child must install and
   run on its own, and a third package for an 80-line helper is not worth the
   release ceremony.
5. **No relative path climbs out of the child.**

The guards live in ReTreever — it is the only tier that can see both sides, so
they are not in this repo and a contributor cloning rapper does not receive
them:

```bash
npx vitest run src/lib/core/harnessGuards/   # from the ReTreever repo
```

Each child also carries its own `lib/noParentNames.test.ts`, which runs in a
bare clone with `npm test`.

If one goes red while you are moving code, it is telling you the child just
stopped being liftable. Fix the shape, do not loosen the rule — and after
touching a guard, plant a violation and watch it fail, because a path edit can
leave a test passing while checking nothing.

### The real wall is an ABSENCE

Rule 3 is not a runtime check. It is `svelte.config.js` defining **no `$lib`
and no `$generated` alias**. A child that reaches for the private parent fails
to **build**, here, on your machine — the same failure it would hit anywhere
else.

Do NOT add `$lib` or `$generated` back to make an import resolve. That is the
one change that quietly re-couples a child to code it will never ship with.

## Where changes go

A child's code belongs to the child's repo — and the installer left you in a
git clone of it, so branch, push and open the PR from inside that folder.
Changes to the shell itself (rig, config, the installer) go to rapper.

Children currently published:

- <https://github.com/Ground-Truth-Data/getCache_offlineMap>
- <https://github.com/Ground-Truth-Data/getCache_OnlineMap>
- <https://github.com/Ground-Truth-Data/ReTreever_where>
- <https://github.com/Ground-Truth-Data/ReTreever_who_what>

## The shell

Each child carries its own `routes/` so it can be lifted into its own repo
whole. A scaffold points `kit.files` straight at that tree — one child, one
route tree. The workspace checkout instead serves every child at once from
rapper's own `src/routes/`: the same `(rt)` and `(gc)` route groups ReTreever
has, each page a one-line re-export of the child's `routes/` page, so the
child's file stays the only copy. The installer deletes that tree from a
scaffold.

So the shell is a component the child's layout renders:
`rig/nav/SharedNav.svelte`, rendered by `rig/Layout.svelte`. It is the owning
product's logo, the child's name, one link per view, and the pill that jumps to
the other tier.

Branding is RAPPER's job, never the child's — the owner name and logo arrive as
PROPS, so the component names no product. A child that imported a logo would
carry its owner's identity into a repo meant to be handed out.

The whole bar sits inside `{#if import.meta.env.DEV}`, so a production build
does not hide it — it never emits it.

`rig/`, `gc/` and `rt/` are the shared tree, and THIS repo is its home —
ReTreever imports them from here through the same `$rig`/`$gc`/`$rt` aliases.
Nothing is copied. `src/app.unique.css` is the one per-tier file: it imports
`$gc/theme.css` and then the tokens the tiers disagree on, which is how a page
declares its tier.
