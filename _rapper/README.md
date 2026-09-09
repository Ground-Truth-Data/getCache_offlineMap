<img width="120" align="right" alt="rapper" src="https://github.com/user-attachments/assets/53029e8e-815f-4fb2-8a35-b97e71beb84e" />

<br/>
<span/>


# rapper

**A thin SvelteKit shell** that runs any one of ReTreever and Get Cache's
component repos on its own. rapper itself carries almost nothing — the
components live in their own repos, and the installer **clones the one you
pick from GitHub**:

- [getCache_OfflineMap](https://github.com/Ground-Truth-Data/getCache_OfflineMap)
- [getCache_OnlineMap](https://github.com/Ground-Truth-Data/getCache_OnlineMap)
- [ReTreever_who_what](https://github.com/Ground-Truth-Data/ReTreever_who_what)
- [ReTreever_where](https://github.com/Ground-Truth-Data/ReTreever_where)

## Get started

```bash
npm create @retreever/rapper
```

It asks which component you want, clones it, installs the dependencies and
starts the dev server — when it prints the big arrows, click the link:

```
  Which ReTreever component?

  ❯ getCache_OfflineMap   Offline map engine
    getCache_OnlineMap    Mapbox online map
    ReTreever_where       Where page
    ReTreever_who_what    Who / What directory pages

  ↑ ↓ to move, ⏎ to choose
```

That's the whole install — the component is running at
<http://localhost:5174/> and Ctrl-C stops it. Afterwards, restart it any time
with:

```bash
cd <project-folder>
npm run dev
```

**Or skip the question with a flag.** Name the component on the command line
and the picker never appears; the project folder defaults to the component's
name, so this is a complete command:

```bash
npm create @retreever/rapper -- --getCache_OfflineMap
```

The name is matched loosely, so case and the underscore do not matter and any
unambiguous fragment will do — `--offline`, `--OFFLINEMAP` and
`--getCache_OfflineMap` all select the same component. `--child=<name>` and
`--child <name>` work too. A fragment matching more than one component, or none,
lists the real options and exits rather than guessing.

Name the folder yourself and it wins, in any position relative to the flags:

```bash
npm create @retreever/rapper my-map -- --offline
```

The `--` matters — it is npm's own separator, and a component flag placed
before it is swallowed by npm and never reaches the installer.

The install-and-run finish only happens in a real terminal. In a pipe, a
Dockerfile or CI there is no one to hand a running server to, so the installer
scaffolds, prints the one command left to run, and exits — same if you pass
`--no-install`.

**Why `npm create` and not `npm install`?** Because it asks you a question, and
`npm install` is not allowed to — it runs unattended on build servers and in CI,
where a prompt has nobody to answer it. `npm create` is the verb that may ask;
it is the same one behind `npm create vite` and `npm create svelte`.

**`npm error code ENOVERSIONS` — "No versions available"?** Your npm has a
release-age cooldown set (`min-release-age` in `~/.npmrc`) and every release of
this package is younger than it. `npm create` ignores `min-release-age-exclude`
(npm 11.18 and 12.0, checked 3 Sep 2026 — the exclude only covers install,
update, outdated and query), so lift the guard for this one command. The flag
goes BEFORE the package name; after the `--` it reaches the installer, not npm:

```sh
npm create --min-release-age=0 @retreever/rapper@latest my-map -- --offline
```

## What you end up with

**One rapper, one component.** A second component means a second install, in a
second folder. What you get is a small npm workspace — the root `package.json`
lists `rapper` and the component as members, so one `npm install` at the root
hoists every dependency once — laid out flat, because that adjacency is what
the `$parent/siblings` alias resolves against:

```
getCache_OfflineMap/        <- the project root: package.json { workspaces }, node_modules/
├── package.json
├── rapper/                 <- the shell; rapper/mounted.json names the component
└── getCache_OfflineMap/    <- the component, a git CLONE, a workspace member
```

**The component folder is a real git clone** of its GitHub repo, checked out
at the exact commit this version of rapper was packed and tested with — branch,
push and open a PR from inside it. (If that commit can't be fetched — no git,
no network, or it hasn't been pushed yet — the bundled snapshot of the same
tree is copied instead; you get identical code but no history.) A component that imports from a sibling component brings that
sibling along too, declared in its own `deps.json` — cloned beside it, never
mounted.

> The offline map's ~50 MB basemap is not in git; `npm run dev` downloads it
> on first run (`getCache_OfflineMap/fetchAssets.sh`).

### Environment

The installer writes `rapper/.env` for the component it mounts; a hand-cloned
rapper starts from `.env.example` (copy it to `rapper/.env`). Nothing here is
required by rapper itself — each variable belongs to a component:

| Variable | Needed by | Unset means |
|---|---|---|
| `VITE_TILES_HOST` | `getCache_OfflineMap` | no tiles are downloaded; the satellite layer still draws, so it reads as "roads are broken" — the console says so on the first line |
| `VITE_MAPBOX_TOKEN` | `getCache_OnlineMap`, `ReTreever_where` | no map is created; the page says which variable is missing |

`npm create` fills in `VITE_TILES_HOST` with Ground Truth's public, read-only
tile hosts (`tiles-prod.getcache.org`, `tiles-dev.getcache.org`), so the
offline map works on day one with no account. Edit `rapper/.env` to point it at
your own worker; `.env.example` shows how to run one locally with no cloud
account at all. That default lives in the installer, never in the component:
the component bakes in no host (its `tierNaming.test.ts` fails if one appears),
so a fork or a lifted copy never inherits someone else's bill.

`VITE_MAPBOX_TOKEN` has no default — a token is billed to whoever created it.

## How it works

A component is source code, not an app — a flat `lib/` + `routes/` folder with
no framework and no `node_modules`. It has nothing to `npm run dev` on its own;
rapper is what makes it runnable.

An installed rapper serves the component's own `routes/` directly:
`rapper/mounted.json` names the component, and `svelte.config.js` derives
`kit.files` (`routes/`, `params/`, `hooks.ts`) from it, so there is one route
tree and no forwarding pages to drift.
(The git checkout of rapper is different: its own `src/routes/` re-exports
every component's pages at once, for developing them side by side; the
installer deletes that tree.) The dev shell — logo, the component's name, one
link per view — is `rig/Layout.svelte`, rendered by the component's layout,
and it only appears in dev. Branding is rapper's job, never the component's.

Dependencies are installed at the PROJECT ROOT, not inside `rapper/` — the
root is an npm workspace and the one folder that is an ancestor of both. Each
member still declares its own dependencies; npm hoists them once.
That is why `npm install` runs at the root and not in `rapper/`.

rapper is a dev harness, not a deployment target. The ReTreever production
site ships through its own pipeline in the ReTreever workspace; nothing this
installer produces is meant to deploy.

### Developing rapper itself

```bash
git clone https://github.com/Ground-Truth-Data/rapper.git
```

Clone the components beside it, not inside it — see CONTRIBUTING.md.

## Contributing

A component's code belongs to the component's repo — and the installer already
left you in a clone of it, so branch, push and open the PR right there.
Changes to the shell itself (rig, config, the installer) go to rapper.

Components must stay **liftable** — self-contained, no reach into ReTreever's
private side, and no import of a sibling that the component's own `deps.json`
does not declare. Guard tests in the ReTreever repo enforce this and find
components by shape, so a new one is governed the day it is created.

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full rules and the reasoning
behind them.
