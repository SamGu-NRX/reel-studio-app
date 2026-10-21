# Reel Studio performance claims

Timing verdicts use three interleaved runs per ref under a fixed 1-minute load guard of strictly below 8. Startup, first edit, both subtitle re-renders, and notes each pass the guard immediately before timing starts. Refused checks are retained and retried after 30 seconds.

Harness SHA-256: 2ee5520c523afd07b57dbb60a2204b483fce430071c1b74f963c1680224c39d4. Method: real-electron-basic-plan-v2-load-guard. Host: Apple M4 Pro, 12 cores, Darwin 25.6.0. Machine and runtime fingerprints match across all accepted trials.

Values are seconds as median [minimum, maximum]. A median delta no larger than the larger full observed range is noise. Confirmed gain and regression mean the median delta exceeds this observed-range rule. This is not a significance test, and neither thermal state nor mid-operation load is controlled.

## Corrected timing verdicts

| Ref | Operation | Main, seconds | Ref, seconds | Delta | Verdict |
|---|---|---:|---:|---:|---|
| ai-note-staging | First edit | 9.326 [8.421, 10.688] | 8.227 [7.896, 8.288] | -11.8% | noise |
| ai-note-staging | Notes | 6.785 [6.777, 6.803] | 7.091 [7.063, 7.284] | +4.5% | regression |
| ai-note-staging | Re-render 1 | 4.302 [4.244, 4.512] | 4.438 [4.345, 4.544] | +3.2% | noise |
| ai-note-staging | Re-render 2 | 4.052 [3.971, 4.134] | 4.065 [3.942, 4.158] | +0.3% | noise |
| ai-note-staging | Startup | 0.821 [0.711, 1.033] | 0.896 [0.890, 0.928] | +9.1% | noise |
| player-smooth | First edit | 9.326 [8.421, 10.688] | 8.285 [7.814, 8.780] | -11.2% | noise |
| player-smooth | Notes | 6.785 [6.777, 6.803] | 6.996 [6.759, 7.053] | +3.1% | noise |
| player-smooth | Re-render 1 | 4.302 [4.244, 4.512] | 4.952 [4.250, 5.153] | +15.1% | noise |
| player-smooth | Re-render 2 | 4.052 [3.971, 4.134] | 4.296 [4.008, 4.867] | +6.0% | noise |
| player-smooth | Startup | 0.821 [0.711, 1.033] | 0.931 [0.890, 1.018] | +13.4% | noise |
| sg/alpha | First edit | 9.326 [8.421, 10.688] | 7.109 [6.863, 7.362] | -23.8% | noise |
| sg/alpha | Notes | 6.785 [6.777, 6.803] | 7.182 [6.754, 7.273] | +5.9% | noise |
| sg/alpha | Re-render 1 | 4.302 [4.244, 4.512] | 4.500 [4.420, 4.511] | +4.6% | noise |
| sg/alpha | Re-render 2 | 4.052 [3.971, 4.134] | 4.150 [4.028, 4.346] | +2.4% | noise |
| sg/alpha | Startup | 0.821 [0.711, 1.033] | 0.518 [0.484, 1.464] | -37.0% | noise |

The b2f3025 Notes trials ran without draft serving because the harness used noncanonical /tmp paths; the #20 worker's [canonical-path re-measurement at c250836](/tmp/rs-evidence/ai-note-staging/guarded-note-perf/README.md#harness-correction-and-reproduction) reports main 6.484 s versus branch 6.583 s, +98.5 ms, inside main's observed range.

## Accepted loads

Each range covers the timed-operation starts within that trial. Raw loadChecks also include refused attempts, with timestamps and operation names.

| Ref | Trial 1 range | Trial 2 range | Trial 3 range | Refused checks |
|---|---:|---:|---:|---:|
| main | 4.83 to 6.82 | 5.28 to 7.81 | 5.69 to 7.81 | 3 |
| ai-note-staging | 6.51 to 7.51 | 5.69 to 6.79 | 6.63 to 7.41 | 8 |
| player-smooth | 7.07 to 7.78 | 5.78 to 7.16 | 6.17 to 7.91 | 6 |
| sg/alpha | 5.88 to 6.56 | 6.54 to 7.18 | 6.84 to 7.85 | 2 |

## Exact tested heads

| Ref | SHA |
|---|---|
| main | 8f618175b9f58da136002fdabb355a719436cd5f |
| ai-note-staging | b2f302508c549de26f7871ec74667325256ee55d |
| player-smooth | 6fbbd919b503eaf7716b6f91c0e7f7041166e069 |
| sg/alpha | b982ccd1b39d3780b01f05af2a9c5ec8ac1f5d1c |

The suite pins these heads before its first build. Every round uses a fresh scratch build, venv, process, profile, project, and engine cache. Raw results and screenshots are in the full-SHA directories, with round-1 through round-3 retaining each build. The exact harness source is in guarded-harness-source/.

## Retained memory and commit verdicts

These verdicts retain their earlier data. They are independent of the corrected timing cohort and apply only to their recorded heads. The old reports are archived under pre-load-guard/. Original cover data remains in origin_main/ and fork_cover-frame-streaming/.

| Claim | Verdict | Measurement | Source and limit |
|---|---|---|---|
| cover-frame-streaming | confirmed, phase-specific memory | 1059.80 [966.55, 1089.11] to 179.47 [164.55, 201.38] MiB | Original origin_main 8f61817 versus fork_cover-frame-streaming 66da344, three unguarded runs. 83.1% lower; full ranges 122.6/36.8 MiB |
| player-smooth | confirmed reduction in committed React work | 18.00 [18.00, 18.00] to 5.00 [5.00, 5.00] commits / 5 s | Main 8f61817 versus player e8d6e22 in the archived three-round cohort. PhonePlayer 18 to 0, dropped frames 0/0. |
| sg/alpha memory | confirmed, historical 9b374a8 | 1057.73 [1055.23, 1105.53] to 199.34 [189.33, 200.86] MiB | Main 8f61817 versus alpha 9b374a8, three interleaved unguarded runs. |
| sg/alpha React commits | regression, historical 9b374a8 | 18 to 595 root commits per 5 seconds | Historical head 9b374a8. This is not a verdict on the newly timed b982ccd. |
| speech-setup model adoption | confirmed local-weight adoption, historical single run | 486,098,798 logical bytes adopted | Historical speech head 5eec35e, one adoption run. Pinned model hash verified and no model download. No new adoption timing claim. |

Earlier timing numbers, including the speech-setup timing comparison, remain archived as unguarded historical observations. They are not accepted guarded timing evidence. The original player 06e724c and earlier alpha 6e2bb8d also had commit regressions; those do not describe the fixed player e8d6e22.

## Output checks and cleanup

| Ref | Full MP4 hashes matching main | Note hashes matching main |
|---|---:|---:|
| main | 9/9 | 3/3 |
| ai-note-staging | 9/9 | 3/3 |
| player-smooth | 9/9 | 3/3 |
| sg/alpha | 9/9 | 3/3 |

Every accepted run created the expected new versions, decoded the matching final player source, passed engine verification, and independently decoded the saved final and note outputs with FFmpeg. All 12 trial builds completed registry-based cleanup with zero survivors before scratch deletion.

Logical and allocated bytes now deduplicate device/inode pairs. APFS clone physical usage is not measured. Historical disk figures in pre-load-guard/ predate the logical-byte fix and may count hard links twice. They are not corrected disk claims. Historical cleaned=true fields predate the crash-safe cleanup fix and are only the old runner reports.

OS file caches stay warm. Startup excludes onboarding. The replay covers one successful caption-note sequence, not inference quality or rollback. Alpha is a whole-ref comparison with different JavaScript dependencies, so no timing result isolates a single feature.

## Checks

npm ci, AI build, typecheck, and six focused harness tests passed. npm test passed 211 AI tests and 211 app tests, with three app tests skipped. Its only failure is the documented macOS Windows-filename title test at app/test/store.test.ts:58. Logs are guarded-check-*.log. The timing suite completed all 12 trials. No product code or dependencies changed.

## Decisions made for Sam

- Use a fixed 1-minute load threshold of 8, strictly below, before every timed operation, including project opening and any optional setup timing. Record refusals and retry after 30 seconds outside timing.
- Pin main to the requested 8f61817 even though fork/main moved. Pin staging, player, and alpha to the fetched heads in guarded-heads.json. Staging moved during setup, so refresh it once immediately before the suite.
- Restart the cohort after the review fixes. Archive the interrupted first guarded attempt under guarded-attempt-1 and exclude it from corrected verdicts.
- Run exactly three interleaved trials per ref on the Aiden clip with the same successful replay note. Use existing offline model weights and read-only FFmpeg. Retain all output validation.
- Preserve earlier memory and commit verdicts with their tested heads. Do not transfer an old commit regression to a newly timed head or recalculate memory claims from this timing cohort.
- Retain scratch and report cleaned=false when registry-based cleanup cannot verify termination. Verify scratch paths in process commands before signalling; media executables may be read-only outside scratch while their input/output paths belong to scratch.
- Use the documented full-range rule: an absolute median difference no greater than either full observed range is noise. Three trials do not constitute a statistical significance test.
- Context7 is unavailable in this session. The code uses existing repository patterns and official Node child_process, fs, and os documentation.
