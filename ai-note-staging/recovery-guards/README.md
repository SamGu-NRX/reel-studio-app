# Recovery guard verification

Head `152e91318640523c1c8beb08e5b7eec7281c8388`.

- `red.log`: the unsafe-path and newer-credit regressions fail on `d3ec625`. Recovery deletes project.json and replaces newer credit bytes with the old file.
- `green.log`: 15 staging tests pass. The unsafe-manifest fixture checks project.json, parent traversal and a symlinked assets directory, with a valid entry preceding the invalid entry. Refusal preserves all files and the manifest. Separate tests check hash-matching credit restoration and preservation of newer credits. A further regression protects external version folders even when no publication manifest exists.
- `store.log`: 2 focused startup tests pass, including partial-cleanup notice deduplication and retaining the latest 50 IDs without deleting chat text.
- `build.log`, `typecheck.log`, `ci.log`: AI build, workspace typecheck and dependency installation pass. Git diff checks pass.

Only two directory syncs were added: staging after the manifest rename, and the project directory after the project.json commit rename. Tests exercised these calls on macOS. No timing or full-suite run, cross-platform durability test, or new TLA+ model check was performed.

The credential environment variable was removed for all tests. Every log was scanned before copying, with no credential-marker matches.

A read-only native review found the pre-existing no-manifest path could follow a symlinked versions directory. The final guard and regression address it. The review found no other issues in manifest validation, conditional credit restoration, sync ordering, interruption retention or cache changes. Cache promotion was not changed.

Invalid manifests remain for inspection. Older pending credit manifests without a merged-credit hash are refused rather than granting unverified overwrite authority.
