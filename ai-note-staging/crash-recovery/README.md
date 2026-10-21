# Publication crash recovery

Commit `d3ec625ddc8c5867f0fefc9ce5838bad00592043` repairs the two publication windows reported by the TLA+ model. The model remains pinned to its original source; this change uses runtime regression tests and does not claim a new model-check result.

- `red.log`: both regressions fail on `9dbb718`. The moved asset remains after precommit recovery, and live project bytes differ from the committed snapshot after the project rename.
- `green.log`: all 11 note-staging tests pass. The existing boundary helper throws immediately after each named publication step. Recovery checks original project/credit bytes, removal of new assets and thumbnails, and exact equality with the committed project snapshot. The style regression injects a crash after the project commit, then checks missing-rule replay and duplicate suppression. The cancellation regression verifies that rollback finishes before a queued manual credit edit.
- `store.log`: the focused interrupted-note test passes when a retry finds only one of two already-announced orphan transactions.
- `app.log`: 12 focused playback and optional-AI tests pass. The no-AI fallback retains publication intent instead of deleting it.
- `build.log`, `typecheck.log`, `ci.log`: AI build, workspace typecheck and dependency installation pass. Diff checks pass.

The credential environment variable was removed for every test invocation. Logs were scanned before copying here, with no credential-marker matches. No timing, full-suite or Electron run was performed for this repair.

The staging manifest is synced before live moves and retains original credit bytes. Moving assets after the project commit would expose missing file references, so recovery reverses uncommitted moves instead. Project and note bytes commit together. Style intent lives in the immutable version and replays before staging deletion. Legacy cover-only writes retain main's behavior outside the note path.

If the optional AI package is removed between a note and relaunch, the app preserves publication intent until the package is restored. It still starts without AI; pending publication recovery requires that package.
