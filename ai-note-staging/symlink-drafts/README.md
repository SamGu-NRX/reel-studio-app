# Symlinked note drafts

Main `8f61817` works. With a projects-directory symlink, its ordinary preview and final URLs return HTTP 206 and the requested bytes. The baseline imports archived main source, uses real files, and mocks only Electron protocol registration. This checks file serving, not video decoding in Electron.

- `main-baseline.test.ts` and `main-source/` preserve the baseline. To repeat, copy the source directory to `app/test/.symlink-main/` and the spec to `app/test/symlink-main-baseline.test.ts`, then run that spec with Vitest. `main.log` records its passing run before implementation.
- `red.log` records the new symlinked-root regression failing on `c250836`: the draft URL is null.
- `green.log` records 12 passing tests after the repair: 11 live tests and the temporary baseline using current production code. The regression also denies a symlink into another transaction and denies access after cleanup.
- `typecheck.log` and `ci.log` record successful typecheck and dependency installation. Diff checks passed. No timing or full suite rerun.

Commit `9dbb718` canonicalizes the staging grant, its project staging parent and the rendered file before containment checks. The media handler accepts canonical root aliases while preserving lexical Library URLs. Access still requires the active transaction grant. Temporary baseline files and fixtures were removed from the worktree.
