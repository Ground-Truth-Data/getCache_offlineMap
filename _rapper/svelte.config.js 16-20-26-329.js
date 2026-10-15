import adapterVercel from "@sveltejs/adapter-vercel";
import adapterStatic from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { mountedChild } from "./scripts/mounted.mjs";

const isCapacitor = process.env.BUILD_TARGET === "cap";
// The three `files` keys below follow `tree` together: pointing `routes` alone
// loses a child's matchers and, silently, its reroute hook.
const tree = mountedChild() ? `../${mountedChild()}` : "src";

/** @type {import('@sveltejs/kit').Config} */
const config = {
    preprocess: vitePreprocess(),
    kit: {
        adapter: isCapacitor
            ? adapterStatic({
                  pages: "build-cap",
                  assets: "build-cap",
                  fallback: "index.html",
                  precompress: false,
                  strict: false,
              })
            : adapterVercel({
                  runtime: "nodejs24.x",
              }),
        // No `$lib`, no `$generated`, on purpose: a child reaching for
        // ReTreever's private side must fail to build here (childBoundary.test.ts).
        alias: {
            // The `../` lives here, never in an import — noEscapePlugin rejects a raw climb.
            "$parent/siblings": "../",
            "$parent/siblings/*": "../*",

            // Each tier points $parent at ITSELF, so a child's `$parent/…` lands in whichever tier is serving.
            $parent: ".",
            "$parent/*": "./*",

            // The shared tree; keep in sync with ReTreever's svelte.config.js, which points these at ../rapper/.
            $rig: "./rig",
            "$rig/*": "./rig/*",
            $gc: "./gc",
            "$gc/*": "./gc/*",
            $rt: "./rt",
            "$rt/*": "./rt/*",

        },
        files: {
            routes: `${tree}/routes`,
            params: `${tree}/params`,
            hooks: {
                universal: `${tree}/hooks`,
            },
        },
    },
};

export default config;
