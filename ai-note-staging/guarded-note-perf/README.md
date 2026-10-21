# Guarded note completion timing

At `c2508365cc01ee832863a64c3d4638dc70f5c852`, three alternating guarded runs measured a 6.583 s note median against main's 6.484 s. The 98.5 ms difference meets the requested +0.1 s target and lies inside main's observed range. The harness labels it noise. Three runs do not establish a bound on every note.

## Final comparison

Main is `8f618175b9f58da136002fdabb355a719436cd5f`. The reported regression was `b2f302508c549de26f7871ec74667325256ee55d`.

| Comparison | Main median [min, max], seconds | Branch median [min, max], seconds | Median difference |
| --- | ---: | ---: | ---: |
| Original guarded report, b2f3025 | 6.785 [6.777, 6.803] | 7.091 [7.063, 7.284] | +0.307 s |
| Final guarded replay, c250836 | 6.484 [6.474, 6.636] | 6.583 [6.495, 6.933] | +0.099 s |

Final main runs: 6.484014, 6.473773, 6.636264 s. Final branch runs: 6.495117, 6.932669, 6.582516 s. They ran main/branch/main/branch/main/branch. Every timed operation started below load 8. Note-start loads were 4.604, 7.500, 6.480 on main and 5.729, 6.853, 7.501 on the branch. Across all final operations the maximum accepted load was 7.749. Refused starts and their subsequent accepted loads are in the reports.

The summed engine-command wall time has a median of 6.419 s on main and 6.451 s on the branch. The rest of note completion has medians of 64.8 and 131.2 ms. Thus the final 98.5 ms difference consists of about 32 ms inside engine calls and 66 ms outside them.

| Engine stages summed across the three render calls, median seconds | Main | Final branch |
| --- | ---: | ---: |
| Audio | 0.330 | 0.330 |
| Layers | 0.030 | 0.030 |
| Encode | 4.260 | 4.380 |
| Cover wait | 0.880 | 0.690 |
| Verify | 0.560 | 0.670 |
| Engine-reported total | 6.230 | 6.250 |

Stage medians do not add to the total median. Cover work overlaps encoding; only its wait is shown here. Engine-reported times are rounded and exclude process startup, unlike engine-command wall time. Both refs made two drafts and one final render. Final videos decoded successfully, playback advanced, and the replay's caption size/color assertions passed.

## Costs and fixes

- `engine/reelengine/cache.py` imported `assets` only for `cache_dir()`. That imported web-search dependencies and media code on every staged engine command. The diagnostic measured 103–125 ms for the import. Moving the directory helper unchanged into the cache module reduces that setup import to 3.6–3.8 ms. Some of the old time was NumPy, which rendering imports later anyway: audio rises from about 30 ms to main's 110 ms per render. The whole import reduction is therefore not an end-to-end saving. The fix avoids only unnecessary imports; cache contents, timestamps and private writes retain their behavior.
- `ai/src/note-staging.ts` synced four independent staged metadata files serially. Profiles measured 42–80 ms before cache promotion. It now prepares their contents, starts the atomic writes together and awaits `Promise.allSettled` before any live publication step. Each write still syncs. A failure waits for sibling writes before cleanup. The final profile measured 35 ms before promotion, compared with 80 ms immediately before this change.
- Cache promotion already clones files and skips live keys. It took 12–14 ms, so it remains after commit and before completion. No background publication work was introduced. Begin-note includes project copying and cache seeding and took about 19 ms. The no-change comparison is below 1 ms. The post-only media-copy path was not used by this caption replay.
- Draft serving is small. Two actual staged range requests returned 206 and took 3.2 ms combined in the final diagnostic. These requests overlap rendering and are not additive to note time.

| Separate diagnostic, milliseconds | b2f3025 original-path profile | f39971e canonical-path profile | c250836 canonical-path profile |
| --- | ---: | ---: | ---: |
| Begin, including cloning | 18.3 | 18.4 | 19.2 |
| Engine command 1, draft | 2550.6 | 2455.2 | 2611.2 |
| Engine command 2, draft | 1571.3 | 1573.4 | 1585.5 |
| Engine command 3, final | 2449.9 | 2428.5 | 2347.4 |
| Publication before promotion | 41.9 | 80.4 | 34.6 |
| Cache promotion | 11.9 | 12.4 | 13.6 |
| Cleanup | 4.4 | 5.5 | 4.4 |
| Content comparisons, combined | not instrumented | 0.55 | 0.55 |
| Draft responses, combined | not served by this harness path | 3.59 | 3.18 |

These are single diagnostic runs with temporary instrumentation, not the acceptance medians. The publication rows are disjoint. Draft requests and some engine work overlap. Engine rendering varies between runs; there is no claim that every observed change comes from the patch.

## Harness correction and reproduction

The harness is borrowed from `fork/perf-harness` at `eb9761e`. Its original `/tmp` scratch path differs from the `/private/tmp` path returned by Python. That mismatch produced null staged draft URLs, so the original report and first candidate comparison did not measure draft serving. For the final comparison both refs use `realpathSync(mkdtempSync(...))`. Both emitted two playable draft URLs; the separate instrumented run also records the 206 responses. No production path or media permission was loosened.

The only acceptance-harness changes are that canonical scratch path and an output folder under `/tmp/rs-note-perf-final`. There are no timing hooks in the acceptance source or committed application. `harness/` retains the exact scripts. Place them at `scripts/perf/` in an isolated checkout with the refs, then run:

```sh
node scripts/perf/suite.mjs --runs 3 --note --models /path/to/existing/small.en 8f618175b9f58da136002fdabb355a719436cd5f c2508365cc01ee832863a64c3d4638dc70f5c852
```

The workload is the harness's real `aiden-v1-new.mp4` fixture and deterministic caption replay, after its first edit and two manual rerenders. Each trial uses a fresh build, process, profile and private cache. OS caches are not flushed. The bundled FFmpeg, fixture, model, dependencies and host fingerprints match within each comparison. The load guard does not control thermal drift or changes after an operation starts. No test suites or diagnostic runs ran alongside acceptance measurements.

`final-comparison/` contains every final raw report and screenshot. `reported-before/` retains the original raw summaries. `profile-final/`, `profile-before-concurrent-metadata/` and `profile-before/` contain the stage diagnostics. The temporary profiling scripts are retained at this folder's top level.

The first candidate f39971e measured 6.423/6.687 s with the original scratch path, then 6.439/6.664 s with canonical paths. Those runs remain in `original-path-comparison/` and `canonical-path-comparison/`. They led to the additional metadata preparation fix, rather than being discarded as unfavorable repeats. The path correction means the old and final cohorts are not an exact one-variable experiment; conclusions use each cohort's paired main baseline.

## Checks

`npm ci`, `npm run build -w ai` and `npm run typecheck` passed. `npm test -- -- --maxWorkers=1` passed 225 AI tests and 219 app tests, with three app skips and only the pre-existing macOS `app/test/store.test.ts:58` failure. After the concurrent metadata change, all 225 AI tests, the AI build and typecheck passed again. The engine suite passed 349 tests with seven skips using the bundled FFmpeg and isolated caches. The import regression fails on b2f3025 and passes on the new engine code. `git diff --check` passed. Logs are in `checks/`.

The final production diff changes only the cache-directory helper/import dependency, its regression test and concurrent preparation of private metadata. Live publish order, cache promotion and preview permissions retain their existing behavior.
