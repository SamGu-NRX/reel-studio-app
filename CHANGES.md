# Roadmap changes, morning → evening of 5 November

Compared with the morning snapshot on the `roadmap` branch (68a884a3). The evening scores use getcurate/reel-studio as of the evening of 5 November and fork/redesign-beta at 3f0ee19.

## Is it all done?

No. Of 128 live items (129 in the list, 1 dropped):

- **Old UI (Aiden's main and open PRs):** 9 merged (100), 5 at 70 (open PR, nothing Blocking, CI passing), 112 below 70 (39 at 50, 50 at 30, 23 at 10 or 0). 2 have nothing to compare (n/a).
- **Redesign (fork/redesign-beta at 3f0ee19):** 64 at 80, which is the ceiling until someone uses a packaged build; 23 at 60; 41 below 60 (14 at 40, 8 at 20, 19 at 0).
- **Moved since the morning:** 18 of the 126 morning items. The new column moved on 18 (18 up); the old column on 0. 3 items were added.
- **P0:** 12 of 13 P0 items are short of done (below 100 in the old UI or below 80 in the redesign). 9 of them are now at 80 in the redesign, so what holds them is Aiden's review. Each, and what it waits on:

- **Instagram: connect with OAuth** (`instagram-posting`), 30 → 40. Outside the code: Meta App Review. Not started: the hosted sign-in service, a Connect button for normal users, and any PR to main.
- **Contain the engine and everything it starts** (`fn-contain`), 50 → 80. Review: #137 has no bot review. Beta has it.
- **One writer per project** (`fn-owner`), 50 → 80. Review: #138 has no bot review (#86 had 6 Blocking items). Beta has the fix it needs and leaves out jobs.share with a reason.
- **Frozen versions and per-render reports** (`fn-reports`), 50 → 80. Review: #139 and #144 have no bot review. Beta has them.
- **The note transaction** (`fn-transaction`), 50 → 80. Review: #140 has no bot review; it lands after #137 to #139. Beta has it.
- **Reliable AI without capping the models** (`reliable-ai`), 50 → 60. Review: #117, #135 and #143 have no bot review. Not started: a recorded live ChatGPT note.
- **Explain why each cover was picked** (`cover-reasons`), 70 → 80. Aiden's call on #17 (no Blocking item, CI passing). Beta has it.
- **Honest progress for the first edit** (`honest-progress`), 50 → 80. Review: the bot hasn't re-read #34 since its 4 November rewrite, so its 4 Blocking items count as open. Beta has the rewrite.
- **Windows fixes in open PRs** (`win-fixes`), 50 → 80. Review: #123 (the rebase of #56) has no bot review. Everything else in the item is merged.
- **Drag-to-Applications install window on Mac** (`mac-install-window`), 50 → 80. Review: #125 has no bot review. Outside the code: a signed install on a real Mac.
- **Measured performance everywhere, like T3** (`perf-all-around`), 50 → 60. Review: #124, #141, #148 to #152, #154 and #155 have no bot review. Port: #152, #154 and #155 into beta. Not started: timing runs on an idle machine.
- **Secure backend and IPC** (`security-hardening`), 50 → 80. Review: #119 has no bot review; #69 waits on Aiden's click. Beta has both.

## Why it moved

- **New column, up.** redesign-beta moved from 41d4898 to 3f0ee19, a fast-forward of 206 commits. It merged Aiden's main d4185a3 and brought in almost every open PR head as merges, cherry-picks or hand ports; its README lists what was left out and why. Five redesign lanes then landed: changed moments on the phone (#157 with ChangeMoments.tsx), pill buttons with a shape check, a first-run Mac notifications step, the real Instagram handle in the preview, and Pace and zoom-in kinds in the edit drawer.
- **Old column, unchanged.** Nothing merged; main is still d4185a3. None of the 42 PRs from #116 on has a bot review, so each stays at 50 whatever its CI says. No old score changed.
- **CI.** All of night 1's PRs now pass all six checks. Of night 2's, #157 has a check failing on gh at the time of this snapshot.

## Every item that moved

Leaves only; an epic's scores are the average of its children.

| Item | Old morning → evening | New morning → evening | Evidence |
|---|---|---|---|
| YouTube: connect and publish (`yt-publish`) | 100 → 100 | 0 → 40 | New: Outs.tsx:84-96,280-296; PostingSettings.tsx; main/posting.ts:98-101; app/e2e/posting.spec.ts |
| Export presets per platform (`pub-export-presets`) | 50 → 50 | 60 → 80 | New: jobs.ts:197-260,288-310; app/e2e/export-stop.spec.ts; app/test/platform-export.test.ts |
| Contain the engine and everything it starts (`fn-contain`) | 50 → 50 | 60 → 80 | New: 704e8f42 ancestor; #137 as one diff; app/src/main/orphans.ts; engine/tests/test_contain.py:49-102 |
| One writer per project (`fn-owner`) | 50 → 50 | 60 → 80 | New: 9824c4db, 8ffe1829 ancestors; attachments.ts:236,302; app/test/attachment-queue.test.ts, owner-token.test.ts |
| Frozen versions and per-render reports (`fn-reports`) | 50 → 50 | 60 → 80 | New: engine/tests/test_note_versions.py:64; render.py:96; test_render_fingerprint.py:35 |
| The note transaction (`fn-transaction`) | 50 → 50 | 60 → 80 | New: ai/test/note-atomic.test.ts; b27a2eb1 ancestor; beta README, 5 November table |
| Port the stack into the redesign (`fn-port`) | n/a → n/a | 60 → 80 | New: 704e8f42, 9824c4db, 8ffe1829, b27a2eb1 are ancestors of 3f0ee19; beta README, 5 November table |
| AI editor picker that really connects (`ai-picker-connects`) | 100 → 100 | 60 → 80 | New: beta README, 5 November (#106 empty); vendor-connect.tsx; app/e2e/editor-hub.spec.ts |
| Explain why each cover was picked (`cover-reasons`) | 70 → 70 | 60 → 80 | New: CoverTab.tsx:118 step 0.1 (#17 ported); components/CoverPicks.tsx; app/e2e/cover.spec.ts:51 |
| Honest progress for the first edit (`honest-progress`) | 50 → 50 | 60 → 80 | New: #34 merged into beta; progress.ts learn() :227; app/test/progress.test.ts |
| Pill buttons, no rounded-square clutter (`pill-buttons`) | 10 → 10 | 60 → 80 | New: 38c6445, c2d1da5; layout-audit detect.ts button-shape; app/e2e/layout-audit-detect.spec.ts |
| Preview on different iPhone shapes (`device-shapes`) | 50 → 50 | 60 → 80 | New: Player.tsx SubtitleSample; app/test/phone-shapes.test.ts; app/e2e/preview-modes.spec.ts:183,203 |
| Smooth T3-style permissions in first run (`first-run-permissions`) | 50 → 50 | 60 → 80 | New: c570fa3; FirstRun.tsx; permissions.tsx; app/e2e/onboarding.spec.ts |
| Signed Windows installer with updates (`windows-signed-updates`) | 50 → 50 | 40 → 60 | New: packaging/electron-builder.yml:155-164; make-config.js; app/test/make-config.test.ts; updater-electron.test.ts:245 |
| Drag-to-Applications install window on Mac (`mac-install-window`) | 50 → 50 | 60 → 80 | New: cbe963a and b9cf6a3 are ancestors of beta; app/test/move-to-applications.test.ts |
| Updates inside the app, T3-style (`in-app-updater`) | 50 → 50 | 60 → 80 | New: UpdateButton.tsx:228-232; update-key.ts; app/test/update-key.test.ts, updater-electron.test.ts; app/e2e/update.spec.ts:114 |
| Secure backend and IPC (`security-hardening`) | 50 → 50 | 60 → 80 | New: ai/src/safety.ts:161; ai/test/secfix.test.ts:192; app/test/ipc-guard.test.ts; app/e2e/ipc-security.spec.ts |
| Keep 60 fps, offer 30 fps (`smooth-60fps`) | 50 → 50 | 60 → 80 | New: render.py:130 preview_fps; compositing/test_preview_fps.py:50,54; app/e2e/source-fps.spec.ts:7 |

Epics that moved:

| Epic | Old morning → evening | New morning → evening |
|---|---|---|
| Post to every platform | 33 → 33 | 31 → 38 |
| A failed note leaves nothing behind | 50 → 50 | 60 → 80 |
| AI editor connections and models | 62 → 62 | 72 → 76 |
| Edit it myself tools | 80 → 80 | 70 → 75 |
| Works on Windows | 50 → 50 | 67 → 73 |
| Install and updates | 50 → 50 | 60 → 80 |
| Performance, security and privacy | 40 → 42 | 55 → 48 |
| Export and send | 60 → 60 | 73 → 80 |

## Items added

- **Added `change-moments`**, Show a change on the phone before its draft (P1, 50 → 80, under Reel screen: player and timeline). #157 (night 2) and the redesign's ChangeMoments.tsx had no item. It answers the wait after a note: stills of the changed seconds first, then a 2 s clip, then the draft. Evidence: #157 open draft, no bot review yet, CI failure; ChangeMoments.tsx (af11155); app/e2e/change-moments.spec.ts; engine/tests/test_moments.py.
- **Added `style-rule-checks`**, My style rules checked on every render (P1, 50 → 0, under My style). #153 (night 2) had no item. It is stacked on #128 and #127, the remember-style and My style edit PRs. Evidence: #153 open draft, no bot review yet, CI passing; No rule-check code on 3f0ee19; #153 not in the beta README.
- **Added `render-equals-fresh`**, An export matches a fresh render (P1, 50 → 0, under Performance, security and privacy). #156 (night 2) had no item. Its test replays draft then export and requires the same bytes as a fresh folder; it found exports reusing draft-quality b-roll. Evidence: #156 open draft, no bot review yet, CI passing; broll.py:545-575 on 3f0ee19; no test_incremental_render.py in the tree.

Nothing was dropped or re-prioritised tonight. perf-all-around gains #152 (whole-app timings), #154 (SDR hardware decode) and #155 (the 1080p copy). The night's eval list (vision/2026-11-05-evals.md) is ideas, not built work, so it gets no item; its one built check is render-equals-fresh.

## How these were scored

- **Old:** the same rule as the morning, on `gh pr view` data taken in the evening: merged 100; open with no Blocking item in the latest `reel-studio-bot` review and CI passing 70; otherwise 50. An item takes its least advanced open PR. Judgment calls are in `tools/snapshot_1105.py`.
- **New:** `git show`, `git grep`, `git diff 41d48981 3f0ee195` and `git merge-base --is-ancestor` on fork/redesign-beta at 3f0ee19, item by item, checked against beta's README table of what came in and what was left out. Every row names a file, test or commit. A PR's fix counts as brought over if beta has it, or if the README gives a reason it isn't needed and the code bears that out.
- **Not run:** I ran no tests and no app. Test names prove a check exists on beta, not that it passes today. Windows results are the night's runs as the progress record reports them.

## The five scores I'm least sure of

1. **Every item scored on an overnight replacement (#116 to #157).** None of the 42 open PRs from #116 on has a bot review, so each sits at 50 even where CI is green and the original had nothing Blocking. A review batch that finds nothing Blocking would lift 30 items to 70 at once.
2. **The new 80s that rest on 'not needed' calls.** pub-export-presets (#147), fn-owner (#138's jobs.share), ai-picker-connects (#106) and device-shapes (#3) reach 80 because beta's README says the PR's fix isn't needed there. The scouts checked each reason in the code, but no test was written to prove the old bug can't happen on beta.
3. **cv-style-seed new 60.** Pace is now set by hand and tested, which reads as 80. I kept 60 because the presets' numbers are marked untested on real output (cut-style.ts:2), and the item is the preset.
4. **reliable-ai new 60.** Every PR fix is in beta and tested. I kept 60, as this morning, because the item's own bar, a recorded live ChatGPT note, still hasn't happened. ai-picker-connects got 80 with the same gap, because its 23 October bar didn't include the live run.
5. **Windows evidence.** win-redesign-run, change-moments and the Pace items rest on the night's Windows runs, reported by other agents in the progress record. Their app and e2e results before about 16:00Z ran with the wrong engine on the path; the ones I cite were rerun after that fix.
