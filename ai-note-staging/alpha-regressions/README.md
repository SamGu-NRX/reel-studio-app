# Alpha integration follow-up

Reviewed head: `63f6de02e1b05b1228ae48c0ead6fed209abab77`. PR14 is `5eec35e288ca8ded19ecb209497deb10c6fa910b`; PR17 is `06db86b9b2dfb3df4265ba829c33d9c756b01a63`. Their GitHub heads matched those local refs at verification.

- `project-engine.ts` forwards the complete caller tuple. The regression passes an extra options object, then repeats after cancellation. Against e628284's original wrapper it fails because the fifth argument is undefined. The original wrapper was extracted unchanged from index.ts into the test seam; the baseline media/store files came directly from the same commit.
- `media.ts` again owns containment and streaming. Only the staging restriction lives in a hook. Three-way file merges in both orders retain PR17's realpath and Library-link logic. The merged handler passes all nine live tests and a temporary integration test for an unlisted external symlink, its Library grant and revocation. The temporary test source is retained here; it is not shipped in the PR.
- `store.ts` records main's interrupted-change text before removing staging, including when app.json is absent. The regression verifies one notice, no staging root, removal of unpublished v2, byte-identical project.json and an idempotent second startup. A committed snapshot's txnId excludes an already-published note from this notice.

`red.log` has three failures on e628284 production code. `green.log` has three passes. `npm-ci.log`, `build.log` and `typecheck.log` pass. `test.log` records 225 AI passes and 218 app passes, three skips and only the documented macOS store.test.ts:58 failure. Python engine code did not change, so engine tests were not repeated.

## Merge limits

The media change merges cleanly in both orders. The complete PRs still require textual conflict resolution; it would be inaccurate to claim whole-branch conflict-free merges. `merge14.txt` and `merge17.txt` are git merge-tree results against the committed head.

| PR | Remaining files | Resolution to preserve both behaviors |
| --- | --- | --- |
| #14 | app/src/main/engine.ts, index.ts | Keep exit notification before cancellation suppression; retain the staging video callback and add workGate; retain staging roots and saved-thread initialization. |
| #17 | app/src/main/engine.ts | Keep the idempotent exit callback and staging's awaited cancellation. |
| #17 | engine/reelengine/cli.py, render.py | Combine picker with staged project/output options; explicit out takes precedence over picker-dependent work directories. |
| #17 | docs/schema-changes.md | Keep both appended sections. |

These are pre-existing overlapping changes, not remaining instances of the dropped-options or relocated-media-check bugs. Other PR features were not imported into #20 to disguise the conflicts. No new Electron screenshots were captured; the recovery text is main's existing wording and its persistence is checked by the store regression.
