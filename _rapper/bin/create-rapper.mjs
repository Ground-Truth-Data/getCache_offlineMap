#!/usr/bin/env node
// Permanent bin target: package.json's bin must point at a file that exists in the
// working tree at publish time, or npm strips the bin entry from the registry
// manifest (the real installer, _director/, exists only between prepack and postpack).
import("../_director/bin/create.mjs");
