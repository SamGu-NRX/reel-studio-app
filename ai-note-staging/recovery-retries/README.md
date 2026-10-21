# Recovery retries

Tested repair: `6c2c58e8f02ac9f5545d232c7ef3a679ca88e01c`.

The regressions reproduce on baseline `152e91318640523c1c8beb08e5b7eec7281c8388` with only the new tests applied. `ai-before.log` shows valid cleanup stopping at the invalid middle transaction and committed publication rejecting EINVAL. `app-before.log` shows the first of 51 pending IDs being dropped.

The repaired staging suite passes all 17 tests. The store suite passes 18 tests; its only failure is the existing Windows-path title assertion on macOS at `app/test/store.test.ts:58`. These tests use temporary projects, actual filesystem cleanup, and an injected directory-sync error. No real user projects are involved.

- `npm ci`: passed, `install.log`.
- `npm run test -w ai -- test/note-staging.test.ts`: 17 passed, `ai.log`.
- `npm run test -w app -- test/store.test.ts`: 18 passed, 1 known failure, `app.log`.
- `npm run build -w ai`: passed, `build.log`.
- `npm run typecheck`: passed, `typecheck.log`.
- `git diff --check`: passed.

Tests ran sequentially with the proxy credential removed from their environment. Logs were checked for credential markers before saving. Full suites, engine tests and timings were not rerun for this TypeScript recovery repair.

Recovery retains invalid manifests, continues with other transactions, and leaves the general unpublished-version sweep for a startup with no refused transaction. Parent checks precede deletion and individual files use unlink. A concurrent local process racing recovery is outside the threat model.

Directory sync treats EINVAL, ENOTSUP and EPERM as unsupported. Other failures propagate before commit; all directory-sync failures after the project rename only warn. The EINVAL regression checks committed success and byte equality between the live project and version snapshot.

The 51-folder test runs three startups. All 51 initially remain invalid, 17 become recoverable on the second startup, and the remaining 34 recover on the third. One aggregate chat notice records every transaction once. IDs remain only for folders still present; the chat text survives their removal.
