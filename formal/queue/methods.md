# Queue concurrency verification

This experiment checks the required queue protocol and exposes implementation gaps. It is not a refinement proof of the application. Source targets are prototype `175956b` and ownership/recovery branch `059e485`. The restored Foundation 2 design and shared brief were read before completing the model.

## Method and assumptions

TLC explores interleavings of three note IDs across two projects. Two notes share a queue. Submission, durable insertion, acknowledgement, job start, render request, permit acquisition, process-group exit, permit release, root commit, and queue settlement are separate actions. A note may also commit without rendering. Waiting entries can be edited, cancelled, or moved past another waiting entry. Promotion takes the queue head. Render acquisition takes the global waiter head.

Crashes can occur between any actions, including before acknowledgement, after commit, and during recovery. They discard volatile jobs and permits while OS process groups may survive. Restart requires all surviving groups to drain, removes committed IDs, and holds queues. The process-group set represents all descendants, not just the parent PID. Atomic durable writes and readable committed receipts are assumptions of this corrected protocol. Disk corruption, fsync failure, PID discovery, multiple render commands within one job, and concurrent manual edits are outside the model. Their implementation obligations remain separate.

Safety permits unlimited crashes and unlimited user edits. The liveness run collapses the two payload values to one because payload never controls a scheduling action. It still explores all three notes and both projects. Weak fairness applies separately to enabled worker actions, draining, recovery, and user Resume. Eventual completion additionally requires an eventual crash-free suffix and strong fairness of cancelling repeatedly waiting failed entries. A failure remains recorded as an outcome even if its queue entry is retried.

Scheduler fairness alone is insufficient. The retained counterexample repeatedly fails, settles, resumes, and retries the first note. The second note never starts. Retiring failed entries would remove that particular user-cancellation assumption, but would change the prototype's retry policy. A user who never resumes a held queue, or an OS group that never drains, also prevents unconditional progress.

`NoDeadlock` excludes Crash, unrelated submissions, edits, and reorder as excuses for progress. Every nonterminal state must enable a worker or recovery action, including explicit Resume. TLC's own deadlock check is also enabled. Neither result promises progress without fairness.

## Results

See `evidence/*.json` for final counts and the exact model hash, and the matching logs for counterexamples. All runs use TLC 2.19 from the v1.7.4 release. The finite bound is evidence, not a proof for arbitrary queue lengths.

| Check | Generated states | Distinct states | Result |
|---|---:|---:|---|
| safety | 17,966,187 | 3,025,520 | Pass |
| liveness | 2,505,376 | 427,860 | Pass |
| permit | 79,515 | 25,207 | OneRender fails |
| remove | 238 | 168 | NoAdmittedLost fails |
| admission | 7 | 7 | AdmissionBeforeAck fails |
| admission-loss | 35 | 31 | NoAdmittedLost fails |
| replay | 82,167 | 26,262 | NoDoubleCommit fails |
| restart | 322,747 | 88,058 | OneRender fails |
| hold | 292 | 192 | HoldUntilResume fails |
| starvation | 63,760 | 17,238 | Fair retry starvation |

The safety run passes `NoDoubleCommit`, `NoAdmittedLost`, `AdmissionBeforeAck`, `OneRender`, `OneProjectJob`, `HoldUntilResume`, and `NoDeadlock`, plus `TypeOK`. Its graph depth is 39. The liveness graph depth is 36. The retry-starvation counterexample uses two notes in one project.

## Mutant witnesses

- `permit`: Stop returns a permit while the first render group remains alive. Another project acquires it. `OneRender` fails.
- `remove`: Start removes the queue entry. A crash erases the only active reference before commit. `NoAdmittedLost` fails.
- `admission`: acknowledgement precedes persistence. `AdmissionBeforeAck` fails; the separate `admission-loss` run continues through a crash and fails `NoAdmittedLost`.
- `replay`: recovery retains a committed entry. Resume runs it again and `NoDoubleCommit` fails.
- `restart`: recovery admits work before old groups drain. Another project starts rendering and `OneRender` fails.
- `hold`: settlement clears a Stop/failure hold without Resume. `HoldUntilResume` fails.

These are injected changes to the abstract protocol, not fault-injected runs of the app.

## Source findings

These findings were checked against the named commits. No Electron or engine execution was performed.

1. **P1, Stop after commit advances the queue.** `app/src/main/note-queue.ts:156` ignores `byStop` when computing `runOn`. Stop during `jobs.ts:153-168` success bookkeeping still permits a `done` event and automatic promotion. Require `!byStop` and preserve the hold even when the stopped note already committed.
2. **P1, a committed note can replay after a read failure.** `note-queue.ts:154` treats an unreadable root as absence, and lines 160 and 176-177 clear the attempt. `pump` at lines 49-55 never reconciles `next.id` against committed IDs before starting. `ai/src/editor.ts:390` appends the duplicate. Reconcile immediately before each promotion and hold uncertain outcomes without treating them as uncommitted.
3. **P2, successful no-change notes strand followers.** `ai/src/editor.ts:354-358` returns success without a receipt. `note-queue.ts:154-161` retains that entry and holds the queue. Persist a terminal no-change receipt or provide an explicit durable completion outcome.
4. **P1, restart forgets an occupied global render slot.** `app/src/main/index.ts:646-653` closes only projects with surviving groups. `render-slot.ts:10` initializes the global counter to zero. A different project can then encode alongside a surviving group. Block global render admission until every old render group has drained.
5. **P1, a swallowed drain failure can release project ownership.** Prototype `ai/src/tools.ts:1405-1411` converts `ENGINE_STUCK` to a recoverable tool result. The corresponding code is lines 1430-1436 at `059e485`; both revisions also suppress first-look errors at `editor.ts:225`. A later render waits on the retained permit; Stop can then surface cancellation and reach `jobs.ts:179-191` cleanup and owner release while the old group lives. Propagate non-drained-engine failures, or record stuck ownership at the runner boundary independently of the eventual job result.
6. **P1, a partial registry rewrite makes recovery fail open.** `app/src/main/orphans.ts:17` rewrites `engines.json` in place. Lines 35-39 treat unreadable data as no surviving groups. A process crash during a rewrite can leave old renderers untracked. Persist the registry atomically and refuse unsafe admission when an existing registry cannot be read. The spawn-to-registration interval also needs an ownership strategy; atomic replacement alone does not close it.
7. **Durability obligation, not a reproduced OS failure.** Prototype `jobs.ts:112-117` and later bookkeeping replace `app.json` without the durable option. `store.ts:128-142` therefore does not establish that later copies preserve acknowledged queue data across power loss. Use a separate durable queue journal or sync every successor write. The admission invariant assumes this storage guarantee; these runs did not establish filesystem behavior on macOS or Windows.

The prototype also deliberately allows a new send to clear an empty queue's hold at `note-queue.ts:87-89`. That differs from a literal "until Resume" contract. The model preserves the strict contract. Animation asset encoding bypasses the engine-render permit, but is not counted here because Foundation 2 scopes that permit to the render command.
