---
id: RES-0014
title: jsdiff array-diff contract and performance
domain: cli
summary: Verified jsdiff `diffArrays` behavior relevant to line-oriented annotation re-anchoring, including its result shape, abort controls, and local comparison with the SPEC-0016 mapper.
created: 2026-07-21
updated: 2026-07-22
---

## Research

The maintained jsdiff project is published on npm as `diff`, not `jsdiff`. Its documented `diffArrays(oldArr, newArr[, options])` API compares array elements with strict equality by default and returns ordered change objects. Each change object has a token `value`, an `added` or `removed` flag for edits, and a `count`; a change with neither flag is a surviving/common token run. Blank-string tokens are retained by `diffArrays`. A custom `comparator(left, right)` is optional.

All current jsdiff diff functions accept `maxEditLength` and `timeout` options. Reaching either limit returns `undefined`. They also support asynchronous calculation through a callback. Source: https://github.com/kpdecker/jsdiff/blob/master/README.md

jsdiff implements Myers diff with two documented performance changes: it stores per-diagonal paths as linked change objects, and it stops considering diagonals that leave the edit graph. The project states that the latter changes simple append/truncate cases from `O(n + d^2)` to `O(n + d)` without changing results. Source: https://github.com/kpdecker/jsdiff/blob/master/README.md#deviations-from-the-published-myers-diff-algorithm

As checked on 2026-07-21, npm listed `diff` 9.0.0 with built-in TypeScript declarations and no package dependencies. Source: https://www.npmjs.com/package/diff

Mocha resolves `diff` 7.0.0 transitively at the workspace root. The private annotations package directly pins `diff` 9.0.0 as a development/build dependency, and the CLI build bundles the package-owned repair code into its executable. Published CLI consumers therefore execute the bundled library code without installing a separate runtime copy.

A local exhaustive comparison used all 364 arrays of length zero through five over a three-token alphabet, for 132,496 old/new pairs. The original in-repo mapper produced a valid longest common subsequence for every pair and produced exactly the same surviving-index map as `diff` 7.0.0 `diffArrays` for every pair. The surviving package implementation is `packages/annotations/src/reanchor.ts`.

A local append-only microbenchmark compared a 1,000-line base with 100, 500, 1,000, and 2,000 appended unique lines. The in-repo mapper took approximately 1.1, 9.0, 32.5, and 124.1 ms; `diff` 7.0.0 took approximately 0.4, 0.3, 0.5, and 0.7 ms in the same process. A full-replacement comparison at 750 old and 750 new unique lines took approximately 71.3 ms in-repo and 34.7 ms with `diff` 7.0.0. These are single-run local probes rather than a maintained benchmark suite.
