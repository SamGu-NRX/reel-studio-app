# Caption-only note timing

The final three-run medians meet the requested target on this APFS Mac. The 8-second note adds 0.031 s, or 7.1%. The 60-second note is within 0.072 s of main, or 0.7%. Three runs do not establish a speedup.

## Final measurements

Seconds, with three runs per side after warm-up, alternating main then branch. Stage values are independently calculated medians of the engine's rounded timing fields; they need not sum to the total. Note total measures the real `applyNote("smaller captions")` call, including staging, engine startup, publish and cleanup.

| Fixture | Code | Audio | Layers | Encode | Cover | Cover wait | Verify | Engine total | Note total |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 8 s | main | 0.04 | 0.02 | 0.20 | 0.00 | 0.00 | 0.06 | 0.36 | 0.438 |
| 8 s | branch | 0.05 | 0.02 | 0.20 | 0.00 | 0.00 | 0.06 | 0.36 | 0.469 |
| 60 s | main | 0.06 | 0.02 | 9.17 | 0.00 | 0.00 | 0.91 | 10.17 | 10.261 |
| 60 s | branch | 0.06 | 0.02 | 8.97 | 0.00 | 0.00 | 0.87 | 10.04 | 10.189 |

The 8-second source and output are 360×640. The 60-second source and output are 1080×1920. Both are 30 fps, generated test patterns with voice-tone audio, a separate music track, one unchanged video b-roll span, captions, and a fixed cover. These are synthetic clips, not a claim about all real reels or every filesystem.

Individual note totals, in measured order:

- 8 s main: 0.483120, 0.434395, 0.437870. Branch: 0.556252, 0.457132, 0.469102.
- 60 s main: 10.876762, 10.071103, 10.260809. Branch: 10.188938, 10.959523, 9.982006.

Main is `8f618175b9f58da136002fdabb355a719436cd5f`. The branch is the final performance patch on `8981b6e8de572c4f8468fd5903c0f19afed703f4`; the pushed head is `2455531c6c05e0d7bfc70c56344677758c35d1ae`. Hardware is Mac16,8 with 12 CPUs, APFS, Node 26.5.0/libuv 1.52.1, Python 3.11. Bundled FFmpeg is 7.1.1-rs2, using libx264 on both sides. Its downloaded archive SHA-256 is `950d3faa4385a8a4eaa0d92baf8f6c043b8e9207a50a7d24e97935d68033bf45`.

## Where time went

1. `fs.copyFile(...COPYFILE_FICLONE)` silently performed full copies. `COPYFILE_FICLONE_FORCE` returned `ENOSYS` on this runtime, recorded in `repeated/results/clone-support.json`. Cache seeding before the fix took median 0.048 s for 6.5 MB and 0.203 s for 49.1 MB. macOS now invokes `/bin/cp -c`, whose clonefile path shares APFS data and falls back to an independent copy on unsupported volumes. No hard links are used. Cloning now takes median 0.015 s for each fixture. Other platforms retain Node's FICLONE path. Timestamps are restored; live caches stay read-only.
2. Python serialized a default music number as `0.0`; saving through TypeScript produced `0`. Old keys hashed these differently. A first caption note could miss its music cache. Main kept the rebuilt cache, while staged notes would repeatedly miss the unchanged live cache. Music keys now normalize integral numbers and recognize older keys using semantically equal live settings. The regression fails on `8981b6e` with "the staged render rebuilt its unchanged music mix" and passes after the fix. The voice digest is reused instead of recomputed during legacy lookup.
3. There is no added span encode. The relevant encode builders are unchanged, and captured FFmpeg commands and filter graphs perform the same work. Every final run on both sides logs one voice hit, one music hit, one b-roll hit, zero misses, and no cover/face-cache rebuild. Both sides encode the full final video. The last main and branch exports have equal SHA-256 hashes for each fixture, recorded in `summary.json`.
4. A separate three-pair 60-second experiment tested cold copied-file pages before native cloning was added. Pre-reading all seeded media twice took median 0.0085 s then 0.0066 s. It did not improve note time: control 11.692 s versus pre-read 12.183 s; encode 9.92 s versus 10.45 s. Production does not pre-read caches.

Final branch begin/publish/cleanup medians are 0.019/0.024/0.001 s for 8 seconds and 0.020/0.027/0.002 s for 60 seconds. Begin includes cloning, so do not add the clone time again. This measured transaction overhead is about 0.05 s. Voice hashing still scales with audio bytes, but is only about 0.005 s for the 60-second fixture.

Before these fixes, an alternating warm-cache diagnostic measured 60-second totals of 11.164 s on main and 13.846 s on the branch, with encode medians 9.97 s and 12.12 s. Encoder child CPU time was similar, approximately 76–78 s on both sides, and the filter graphs matched. Other desktop processes were active, including Google Drive and suggestd. That run cannot attribute the entire wall-clock encode difference to cache copying. The final runs show no remaining encode penalty. The earlier one-run 0.858/2.013 s comparison is retained in the original evidence files but is superseded by these repeated measurements.

Unsupported clone filesystems still incur real copies. That fallback is isolated and correct, but its performance was not measured here. No cache optimization changes the publish order or writes into live caches.

## Method and retained evidence

`repeated/results/*-final-{1,2,3}.json` contains the twelve final timings. Matching `*-trace.json` files contain cache hits/misses, subprocess commands, filter graphs, and child resource usage. `*-baseline-*` is the pre-fix comparison; `*-control-*` and `*-preread-*` are the page-cache experiment. `summary.json` contains the medians and export hashes. Warm-up and pilot files remain labeled separately and are excluded from the medians.

The scripts in `repeated/` were run from the worktree's disposable `.scratch-note-perf/` directory. To reproduce, copy them there, provide the checksum-verified bundled binaries under `ffmpeg/`, archive main's `ai` and `engine` under `main/`, compile both AI packages, and install engine development dependencies in `.venv-engine`. Run `prepare.py` with `PYTHONPATH=engine`. Run `node .scratch-note-perf/benchmark.cjs <main|branch> <8|60> warm` once per fixture/side. Warm-up saves through TypeScript first, so both sides start from equivalent JSON and completed caches. Then alternate `main` and `branch` with mode `note` and labels `final-1`, `final-2`, `final-3` for each duration. Each note starts from the same saved baseline and a clean v2 destination; fixture resets happen outside the timed call. Benchmark instrumentation is confined to these scripts. No application, test suite, or reviewer job was started concurrently with the final measurements.

## Checks

`npm ci`, AI build and typecheck passed. `npm test` passed 218 AI tests and 213 app tests with three app skips; only the known macOS `app/test/store.test.ts:58` failure remains. Engine tests passed 346 with seven skips. The new numeric-key assertion fails on the pre-fix commit. Logs are in `repeated/rs-staging-perf-*.log`.

The focused independent review inspected all four changed files against `8981b6e`, found no issues, and passed the staged-cache regression and five AI note-staging tests. Disposable fixtures, engine environment, and downloaded binaries were removed after verification.
