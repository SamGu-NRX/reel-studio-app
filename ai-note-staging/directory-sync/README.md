# Directory sync permission failure

Tested repair: `cf379c5404e4c3cfb1156991f3b97959c43d2ed7`.

On `6c2c58e`, the new test injects EPERM when opening the staging directory for sync. Publication incorrectly resolves to version 2. See `before.log`.

With the fix, all 18 staging tests pass (`after.log`). The new test checks the publish rejects, the live project bytes and v1 video remain unchanged, no v2 exists, and the new asset has not moved live. The existing post-commit EINVAL test still returns committed success.

Only EINVAL and ENOTSUP thrown by fsync itself are treated as unsupported. Open and close errors propagate, as do all other fsync errors. The existing post-commit caller logs these errors and keeps success.

Checks ran sequentially with the proxy credential unset. Logs were scanned before saving. `npm ci`, the AI build, typecheck and diff checks passed. No full-suite, engine or timing rerun.
