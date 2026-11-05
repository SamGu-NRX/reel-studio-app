# Roadmap changes, 23 October → 5 November

## Is it all done?

No. Of 125 live items (126 in the list, 1 dropped):

- **Old UI (Aiden's main and open PRs):** 9 merged (100), 5 at 70 (open PR, nothing Blocking, CI passing), 109 below 70 (36 at 50, 50 at 30, 23 at 10 or 0). 2 have nothing to compare (n/a).
- **Redesign (fork/redesign-beta at 41d4898):** 47 at 80, which is the ceiling until someone uses a packaged build; 38 at 60; 40 below 60 (14 at 40, 8 at 20, 18 at 0).
- **Moved:** 77 of the 124 items from 23 October changed score. The old column moved on 44 (35 up), the new column on 69 (65 up).
- **P0:** 13 of 13 P0 items are short of done (below 100 in the old UI or below 80 in the redesign). Each, and what it waits on:

- **Instagram: connect with OAuth** (`instagram-posting`), 30 → 40. Outside the code: Meta App Review. Not started: the hosted sign-in service the developer-only client expects, and any PR to main.
- **Contain the engine and everything it starts** (`fn-contain`), 50 → 60. Review: #137 has no bot review, and its Windows CI job failed. Port: 704e8f4 into beta.
- **One writer per project** (`fn-owner`), 50 → 60. Review: #138 has no bot review (#86 had 6 Blocking items, which the rebase says it fixes). Port: 9824c4d and 8ffe182 into beta.
- **Frozen versions and per-render reports** (`fn-reports`), 50 → 60. Review: #139 and #144 have no bot review. Port: the same three fixes into beta.
- **The note transaction** (`fn-transaction`), 50 → 60. Review: #140 has no bot review; it lands after #137 to #139. Port: the same three fixes into beta.
- **Port the stack into the redesign** (`fn-port`), n/a → 60. Port: 704e8f4, 9824c4d and 8ffe182, then whatever review changes in #137 to #140.
- **Reliable AI without capping the models** (`reliable-ai`), 50 → 60. Review: #117, #135 and #143 have no bot review. Not started: a recorded live ChatGPT note.
- **Explain why each cover was picked** (`cover-reasons`), 70 → 60. Aiden's call on #17 (no Blocking item, CI passing). Port: #17's 4 November slider fix into beta.
- **Honest progress for the first edit** (`honest-progress`), 50 → 60. Review: the bot hasn't re-read #34 since its 4 November rewrite, so its 4 Blocking items count as open. Port: that rewrite into beta.
- **Windows fixes in open PRs** (`win-fixes`), 50 → 80. Review: #123 (the rebase of #56) has no bot review. Everything else in the item is merged.
- **Drag-to-Applications install window on Mac** (`mac-install-window`), 50 → 60. Review: #125 has no bot review. Outside the code: a signed install on a real Mac.
- **Measured performance everywhere, like T3** (`perf-all-around`), 50 → 60. Review: #124, #141 and #148 to #151 have no bot review. Not started: timing runs on an idle machine.
- **Secure backend and IPC** (`security-hardening`), 50 → 60. Review: #119 has no bot review; #69 waits on Aiden's click. Port: #69's 4 November fix into beta.

## Why so much moved

- **New column.** The redesign moved from redesign-alpha to redesign-beta: Aiden's main as of 28 October, every PR head open then, the redesign's screens and about 30 fork branches (Instagram and TikTok connections, insights, the learning loop, the cut vocabulary, multi-clip, the MCP harness, preview modes, more reels, the Windows test fixes). That raised most scores. A few fell: where beta holds a PR from before its later fixes (#3, #17, #34, #31, the failed-note stack), the scale says 40 or 60 however good the 23 October branch was, and main's merges since 29 October (#106, #96, #107, #97, #109) are not in beta.
- **Old column, down.** The 4 November rebases (#116 to #147) replaced 28 PRs. None has a bot review yet, so the scale puts each at 50, even where the original was at 70 with nothing Blocking.
- **Old column, up.** 37 PRs merged after 23 October, 25 of them in an item (#28, #36, #54, #57, #62, #65, #82, #89, #90, #109 and others). Fork branches with no PR now count 30, as the scale says; most were made after the 23 October build.

## Every item that moved

Leaves only; an epic's scores are the average of its children.

| Item | Old 23 Oct → 5 Nov | New 23 Oct → 5 Nov | Evidence |
|---|---|---|---|
| Instagram: connect with OAuth (`instagram-posting`) | 10 → 30 | 0 → 40 | Old: fork branch, no PR: fork/ig-connect<br>New: instagram-oauth.ts, instagram-store.ts; instagram-ipc.ts:13 off unless developer mode; app/test/instagram.test.ts |
| Instagram: publish a reel (`ig-publish`) | 10 → 30 | 0 → 40 | Old: fork branch, no PR: fork/ig-connect<br>New: main/instagram.ts publish behind developer mode; Outs.tsx:257; instagram.test.ts |
| TikTok: log in (`tt-login`) | 0 → 30 | 0 → 40 | Old: fork branch, no PR: fork/tiktok-connect<br>New: main/tiktok-oauth.ts, tiktok-store.ts; index.ts:726 registers TikTok only in developer mode; app/test/tiktok.test.ts |
| TikTok: publish (`tt-publish`) | 0 → 30 | 0 → 40 | Old: fork branch, no PR: fork/tiktok-connect<br>New: main/tiktok.ts publish; preload tiktok.publish; tiktok.test.ts; nothing in SharePlatforms.tsx |
| Trial reels: try two versions (`trial-reels`) | 70 → 30 | 60 → 60 | Old: #61 closed 2026-11-03 |
| Export presets per platform (`pub-export-presets`) | 50 → 50 | 40 → 60 | New: #52's head is in beta; main/platform-export.ts:111; app/test/platform-export.test.ts |
| Contain the engine and everything it starts (`fn-contain`) | 50 → 50 | 40 → 60 | New: app/src/main/proctree.ts; engine/tests/test_contain.py; app/test/orphans.test.ts; #85 lacks 704e8f4 only |
| One writer per project (`fn-owner`) | 50 → 50 | 40 → 60 | New: app/src/main/owner.ts; app/test/owner-token.test.ts; engine/tests/test_owner.py; 1d2aea9 is in beta |
| Frozen versions and per-render reports (`fn-reports`) | 50 → 50 | 20 → 60 | New: render.py:1008-1020; engine/tests/test_note_versions.py; bdef3f7, 3dc091f, c719837 are in beta |
| The note transaction (`fn-transaction`) | 70 → 50 | 40 → 60 | Old: #140 (replaces #29) open draft, no bot review yet, CI passing<br>New: ai/test/note-atomic.test.ts incl. 'Stop during the final render'; 46a14b8 is in beta |
| Port the stack into the redesign (`fn-port`) | n/a → n/a | 0 → 60 | New: git merge-base: da7c0a7, 886fcae, c295dd0, 1d2aea9, bdef3f7, 3dc091f, c719837, 46a14b8 are ancestors of 41d4898 |
| AI editor picker that really connects (`ai-picker-connects`) | 30 → 100 | 80 → 60 | Old: #90 merged 2026-10-26; #106 merged 2026-10-30; #110 merged 2026-11-04<br>New: vendor-connect.tsx:391-467; app/e2e/editor-hub.spec.ts; aad7c8c (#106) not in beta |
| Small model writes titles and status (`small-model-titles`) | 50 → 50 | 40 → 80 | New: app/src/main/version-title.ts; Reel.tsx:756-760; app/test/version-title.test.ts |
| Use my own AI server or key (`custom-ai-server`) | 50 → 100 | 80 → 80 | Old: #36 merged 2026-10-29 |
| Pick a model for each role (`per-role-models`) | 10 → 10 | 60 → 80 | New: ai/src/index.ts:85-95; editor-limits.tsx:264; app/e2e/editor-hub.spec.ts:145 |
| Explain why each cover was picked (`cover-reasons`) | 50 → 70 | 60 → 60 | Old: #17 open, 0 Blocking, review predates the head, CI passing |
| Edit it myself drawer (`edit-it-myself`) | 100 → 100 | 60 → 80 | New: screens/edit/*Tab.tsx; app/e2e/edit-sounds.spec.ts, subtitles.spec.ts, mirror.spec.ts |
| Port pro effects like motion blur (`pro-effects`) | 70 → 50 | 0 → 60 | Old: #116 (replaces #64) open draft, no bot review yet, CI passing<br>New: render.py:521-534; zoom.py:41; compositing/test_snap_zoom.py:99 |
| Honest progress for the first edit (`honest-progress`) | 50 → 50 | 80 → 60 | New: Composer.tsx:27-185; shared/live.ts:96,100; app/test/live.test.ts:188; beta has #34 at 48cafc0 |
| Intentional motion per Emil's guide (`intentional-motion`) | 50 → 30 | 60 → 60 | Old: #12 closed 2026-11-03 |
| Big player view with live edits (`focus-view`) | 30 → 30 | 60 → 80 | New: components/timelineShown.ts; Reel.tsx:969; app/e2e/timeline-lanes.spec.ts:236-275 |
| Watch the reel full screen, vertically (`fullscreen-reel`) | 50 → 50 | 60 → 80 | New: components/FullStage.tsx:95-203; 4d64b0e (preview-modes); app/e2e/preview-modes.spec.ts:34 |
| Preview on different iPhone shapes (`device-shapes`) | 50 → 50 | 0 → 60 | New: shared/phone-shapes.ts:58-62; PreviewControls.tsx:70-115; app/test/phone-shapes.test.ts; 4d64b0e |
| Remember my caption style for new reels (`remember-style`) | 50 → 50 | 60 → 80 | New: #63 and #80 commits in beta; app/e2e/remember-caption-case.spec.ts; ai/test/remember-caption-case.test.ts |
| Memory panel that's easy to scan (`memory-panel`) | 50 → 50 | 40 → 80 | New: MyStyle.tsx:199,385-410; app/e2e/memory-panel.spec.ts; #82 and #83 commits all in beta |
| Learn from my past edits elsewhere (`reference-import`) | 70 → 30 | 60 → 60 | Old: #70 closed 2026-11-03 |
| Reuse a listening model already installed (`reuse-listening-model`) | 50 → 50 | 60 → 80 | New: main/models.ts:137; app/e2e/listening.spec.ts:42; #37 commits all in beta |
| Magical first run with a live demo (`magical-onboarding`) | 30 → 30 | 60 → 80 | New: FirstRun.tsx:48-169; first-run/demo.ts; app/e2e/onboarding.spec.ts:52; firstrun.spec.ts |
| Clear Paused and Didn't finish cards (`home-card-states`) | 30 → 30 | 60 → 80 | New: home.css:57-69,121-125; Home.tsx:385-420; app/e2e/home-cards.spec.ts |
| Settings sections per spec §8 (`rd-settings-sections`) | 30 → 30 | 60 → 80 | New: settings-index.ts:5-41; Settings.tsx:526-559; app/e2e/settings.spec.ts:47 |
| Windows fixes in open PRs (`win-fixes`) | 70 → 50 | 0 → 80 | Old: #123 (replaces #56) open draft, no bot review yet, CI passing; #57 merged 2026-10-29; #62 merged 2026-10-29; #65 merged 2026-10-29; #89 merged 2026-10-29<br>New: installer.nsh:40; app/e2e/titlebar.spec.ts; Windows report batch 20 (28 Oct) |
| Run the redesign on Windows (`win-redesign-run`) | 50 → 50 | 20 → 80 | New: Windows report batch 20: win-tests-green off beta 4de5f6d, merged into beta |
| Signed Windows installer with updates (`windows-signed-updates`) | 50 → 50 | 20 → 40 | New: update-machine.ts:110-114; updater-electron.test.ts:141; electron-builder.yml:154-157 |
| Drag-to-Applications install window on Mac (`mac-install-window`) | 50 → 50 | 40 → 60 | New: packaging/dmg/make-dmg.sh; move-to-applications.test.ts; beta has #31 at 54ac95f |
| Updates inside the app, T3-style (`in-app-updater`) | 50 → 50 | 40 → 60 | New: UpdateButton.tsx:209; UpdateSettings.tsx:41; updater.test.ts; update.spec.ts:97 |
| Install and update through Homebrew (`homebrew-install`) | 50 → 30 | 20 → 0 | Old: #1 closed 2026-10-29<br>New: No Casks/ or cask workflow in beta's tree |
| Measured performance everywhere, like T3 (`perf-all-around`) | 50 → 50 | 40 → 60 | New: scripts/perf/run.mjs; app/e2e/player-perf.spec.ts:36-91 |
| Instagram: insights per reel (`ig-insights`) | 10 → 30 | 0 → 40 | Old: fork branch, no PR: fork/insights-data<br>New: main/instagram.ts:331-366 saves outcomes.json; app/test/insights.test.ts |
| TikTok: analytics per video (`tt-analytics`) | 0 → 30 | 0 → 40 | Old: fork branch, no PR: fork/insights-data<br>New: main/tiktok.ts:353-369; tiktok-ipc.ts; tiktok.test.ts |
| Audience insights in plain words (`audience-readout`) | 0 → 0 | 0 → 20 | New: main/insights.ts; app/test/insights.test.ts; Insights.tsx empty |
| Save to iCloud Drive and Google Drive (`cloud-drives`) | 70 → 30 | 60 → 80 | Old: #47 closed 2026-11-03<br>New: main/cloud-drive.ts:89,139; app/test/cloud-drive.test.ts; app/e2e/cloud-drive.spec.ts |
| A/B trials decided on their own (`lr-ab-trials`) | 10 → 30 | 0 → 20 | Old: fork branch, no PR: fork/learning-loop (engine trial log)<br>New: engine/reelengine/variation.py; engine/tests/test_variation.py; no caller in app/src |
| Capture outcomes per post (`lr-outcomes`) | 10 → 30 | 0 → 40 | Old: fork branch, no PR: fork/insights-data<br>New: main/instagram.ts:331-366; main/tiktok.ts:353-369; main/insights.ts; insights.test.ts |
| Variations of one reel in different styles (`style-variations`) | 10 → 30 | 0 → 20 | Old: fork branch, no PR: fork/learning-loop (variation.py)<br>New: engine/reelengine/variation.py:16; engine/tests/test_variation.py:78 |
| Score each edit with an eval (`edit-eval`) | 30 → 30 | 0 → 20 | New: ai/src/editor.ts:385; ai/test/checker.test.ts; no eval scripts in beta |
| Learning loop: results become memory proposals (`lr-loop`) | 10 → 30 | 0 → 40 | Old: fork branch, no PR: fork/learning-loop<br>New: ai/src/learning.ts:129; ai/test/learning.test.ts; ai/test/style-proposals.test.ts |
| Seeded variation from a logged seed (`lr-seeded-variation`) | 10 → 30 | 0 → 60 | Old: fork branch, no PR: fork/learning-loop<br>New: engine/reelengine/variation.py:25,83; engine/tests/test_variation.py:27,41; test_cut_style.py |
| Queue, steer and stop notes like T3 (`queue-steer-stop`) | 50 → 70 | 60 → 60 | Old: #58 open, 0 Blocking, CI passing |
| Render identity and frame snapshots (`ai-frame-snapshot`) | 50 → 50 | 20 → 80 | New: ai/src/tools.ts:2119-2132; compositing/test_render_identity.py; ai/test/receipts.test.ts |
| Verification agent checks each edit (`checker-agent`) | 50 → 70 | 20 → 80 | Old: #73 open draft, 0 Blocking, CI passing<br>New: ai/src/editor.ts:390,633; Settings.tsx:89-95; ai/test/checker.test.ts |
| Multi-harness subagents (`ah-subagents`) | 10 → 30 | 0 → 40 | Old: fork branch, no PR: fork/mcp-harness-2<br>New: ai/src/index.ts:775-789; ai/test/harness-checker.test.ts |
| The editor's tools over MCP (`ah-mcp`) | 10 → 30 | 0 → 60 | Old: fork branch, no PR: fork/mcp-harness<br>New: ai/relay/mcp-relay.js; ai/src/mcp/run.ts; ai/test/mcp-harness.test.ts |
| Versions as a branching tree, like Git (`version-tree`) | 0 → 30 | 0 → 40 | Old: fork branch, no PR: fork/version-merge<br>New: app/src/main/index.ts:1187-1199; ai/test/version-tree.test.ts, version-merge.test.ts |
| Fix Add Song crash and slow open (`add-song-crash`) | 50 → 50 | 40 → 60 | New: 1985e17 and 8c84bfe are ancestors of beta; engine/tests/test_decode_frames.py; app/e2e/edit-sounds.spec.ts:58 |
| Sound effects from short-form pros (`sfx-pack`) | 50 → 70 | 60 → 80 | Old: #72 open, 0 Blocking, CI passing<br>New: #72's head in beta; compositing/test_sfx.py; app/test/sfx.test.ts; app/e2e/edit-sounds.spec.ts:31-67 |
| Asset tools for pictures, clips and music (`asset-tools`) | 50 → 50 | 60 → 80 | New: #55 and #71 heads in beta; ai/src/tools.ts:763-860; ai/test/asset-media.test.ts; engine/tests/test_asset_media.py |
| Web footage search for the AI (`footage-search`) | 50 → 70 | 20 → 60 | Old: #55 open, 0 Blocking, CI passing<br>New: ai/test/stock.test.ts; stock-keys.tsx; ai/test/stock-settings.test.ts |
| Per-join transitions: J, L, smash and match cuts (`fast-cut-jcuts`) | 10 → 30 | 0 → 60 | Old: fork branch, no PR: fork/cut-vocab<br>New: engine/reelengine/cut.py:152-178; ai/test/joins.test.ts; engine/tests/test_cut_vocab_integration.py |
| Reel-level cut style preset plus seed (`cv-style-seed`) | 10 → 30 | 0 → 60 | Old: fork branch, no PR: fork/cut-vocab<br>New: ai/src/tools.ts:1401; ai/test/cut-style.test.ts; engine/tests/test_cut_style.py |
| Named zoom kinds with a ramp (`cv-zoom-kinds`) | 50 → 50 | 20 → 80 | New: ai/src/tools.ts:1842-1844; compositing/test_zoom_kinds.py, test_snap_zoom.py; ai/test/zoom-kinds.test.ts |
| Opening density per style (`cv-opening-density`) | 10 → 30 | 0 → 60 | Old: fork branch, no PR: fork/cut-vocab<br>New: ai/prompts/system.md:77; ai/src/cut-style.ts:3-6; ai/test/cut-style.test.ts:138 |
| Beat accents via snap_to_beat (`cv-beat-accents`) | 10 → 30 | 20 → 60 | Old: fork branch, no PR: fork/beat-accents<br>New: engine/reelengine/music.py:746-781; broll.py:182; compositing/test_beat_accents.py |
| Timeline lanes for cuts, B-roll and fades (`timeline-ab-roll`) | 10 → 30 | 0 → 80 | Old: fork branch, no PR: fork/timeline-lanes<br>New: app/e2e/timeline-lanes.spec.ts:123; app/test/lanes.test.ts; Timeline.tsx:241-247,305 |
| Visual-change meter (`cv-change-meter`) | 0 → 30 | 0 → 80 | Old: fork branch, no PR: fork/cut-vocab<br>New: engine/reelengine/cut_style.py; engine/tests/test_cut_style.py:8; ai/test/cut-style.test.ts |
| Caption templates to start from (`caption-looks`) | 50 → 50 | 60 → 80 | New: #53 head in beta; app/e2e/caption-looks.spec.ts:9; app/test/caption-presets.test.ts |
| Fix and re-split transcript words (`transcript-editing`) | 50 → 100 | 60 → 80 | Old: #54 merged 2026-11-04<br>New: #54 head in beta; components/SubtitleLines.tsx; app/e2e/subtitles.spec.ts:15 |
| Drop, paste or AirDrop a video, animated (`drop-paste-airdrop`) | 70 → 50 | 80 → 80 | Old: #134 (replaces #46) open draft, no bot review yet, CI cancelled |
| New reel opens a planning chat (`plan-in-chat`) | 30 → 30 | 60 → 80 | New: ai/src/editor.ts:828-830; app/e2e/plan.spec.ts:22,143,173 |
| Group reels into series automatically (`series-grouping`) | 10 → 30 | 20 → 40 | Old: fork branch, no PR: fork/more-reels (a series for reels made from one video)<br>New: app/src/main/propose-reels.ts:113-134; Home.tsx:130-192; app/test/propose-reels.test.ts |
| Make CI run on the fork (`fork-ci`) | n/a → n/a | 0 → 20 | New: gh run list -R SamGu-NRX/reel-studio-app; ba2c807 in beta |
| PR templates, labels and trusted contributors (`repo-pr-templates`) | 70 → 100 | 60 → 60 | Old: #28 merged 2026-10-29 |
| Test-audit skill in the repo (`test-audit-skill`) | 10 → 10 | 60 → 0 | New: ls-tree 41d4898: no .claude or skills paths |
| Nightly alpha builds on GitHub (`nightly-builds`) | 0 → 30 | 0 → 60 | Old: fork branch, no PR: fork/infra/nightly, green run 40811441841 on 29 Oct<br>New: fork/infra/nightly nightly.yml; run 40811441841; app/test/nightly-channel.test.ts |
| Propose many reels from raw footage (`raw-to-many-reels`) | 10 → 30 | 0 → 60 | Old: fork branch, no PR: fork/more-reels<br>New: ai/src/propose.ts; app/test/propose-reels.test.ts; app/e2e/more-reels.spec.ts:14 |
| Edit a reel from many clips (`multi-clip-editing`) | 10 → 30 | 0 → 60 | Old: fork branch, no PR: fork/multi-clip-intake<br>New: ai/src/editor.ts:319; Timeline.tsx:296; engine/tests/test_multi_source.py; ai/test/multi-source.test.ts |
| Index my footage once to save tokens (`smart-indexing`) | 0 → 30 | 0 → 60 | Old: fork branch, no PR: fork/footage-index<br>New: app/src/main/index.ts:260-261; engine/tests/test_footage.py; app/test/footage-index.test.ts |
| Multi-source projects (schema change) (`mc-sources`) | 0 → 30 | 20 → 80 | Old: fork branch, no PR: fork/multi-source<br>New: engine/tests/test_multi_source.py; ai/test/multi-source.test.ts; tools.ts:1321-1351 list_sources, set_clips |

Epics:

| Epic | Old 23 Oct → 5 Nov | New 23 Oct → 5 Nov |
|---|---|---|
| Post to every platform | 18 → 33 | 12 → 31 |
| A failed note leaves nothing behind | 55 → 50 | 28 → 60 |
| AI editor connections and models | 38 → 62 | 64 → 72 |
| Edit it myself tools | 80 → 80 | 50 → 70 |
| Redesign that keeps Aiden's minimal feel | 32 → 31 | 65 → 70 |
| Works on Windows | 57 → 50 | 13 → 67 |
| Install and updates | 50 → 50 | 33 → 60 |
| Performance, security and privacy | 37 → 40 | 40 → 55 |
| Analytics per platform | 2 → 15 | 0 → 25 |
| Export and send | 73 → 60 | 67 → 73 |
| Learns what works over time | 11 → 24 | 0 → 25 |
| Agent harness: queue, render identity, checks, MCP | 34 → 50 | 20 → 64 |
| Versions | 33 → 43 | 53 → 67 |
| Assets and sound | 50 → 60 | 45 → 70 |
| Cut vocabulary Claude can choose from | 11 → 26 | 4 → 53 |
| Captions and graphics | 30 → 42 | 35 → 45 |
| From idea to first edit | 37 → 37 | 53 → 67 |
| Repo, CI and builds | 42 → 54 | 40 → 43 |
| Find your niche and growth | 15 → 15 | 0 → 0 |
| Footage and multi-clip | 4 → 24 | 4 → 52 |
| Accounts, sync, phone and browser | 20 → 20 | 0 → 0 |

## Items added, dropped or changed

- **Added `yt-publish`**, YouTube: connect and publish (P1, 100 → 0, under Post to every platform). #109 merged on 4 November, hidden behind REELSTUDIO_POSTING=1. The 23 October list had YouTube only inside 'Later platforms'.
- **Added `a11y-dialog-focus`**, Keyboard focus stays inside dialogs (P2, 50 → 80, under Performance, security and privacy). #77 (now #118) had no item on 23 October.
- **Dropped `homebrew-install`**, Install and update through Homebrew. Aiden closed #1 on 29 October under the merge plan (#93): redo it as a separate tap repo if wanted. The in-app updater replaces it.
- **Re-prioritised `cloud-drives`** P1 → P2. Aiden closed #47 on 3 November: cloud storage is deferred and will be designed around a new file layout.
- **Retitled `pub-later`** from "Later platforms: YouTube Shorts and others" to "Later platforms: Threads, X, LinkedIn and others". YouTube moved to its own item.

Who an item waits on:

- `cloud-drives`: waits on "Aiden closed #47 on 3 November: cloud storage deferred until a new file layout" (#47 closed)
- `trial-reels`: waits on "Aiden closed #61 on 3 November: on hold while the PR queue lands" (#61 closed)
- `reference-import`: waits on "Aiden closed #70 on 3 November: nothing in the app calls it yet, and real exports are untested" (#70 closed)
- `device-shapes`: no longer waits on anyone outside the review queue (The redesign brought the picker back (preview-modes, 4d64b0e), so there is nothing left to rule on.)
- `perf-all-around`: no longer waits on anyone outside the review queue (#93 closed #26; the new speed harness #141 waits on review, not a decision.)
- `send-to-phone`: no longer waits on anyone outside the review queue (#48 merged on 4 November, settling the row order.)
- `windows-signed-updates`: no longer waits on anyone outside the review queue (#97 merged Azure Artifact Signing on 30 October, so the signing account is no longer an outside blocker.)
- `test-audit-skill`: waits on "Aiden closed the skills PR #91 on 3 November: land the leak rule alone first, then a small AGENTS.md (#115)" (#91 closed)
- `sfx-pack`: waits on "Parked until after launch in the merge plan (#93); four decisions on #72" (#93)
- `asset-tools`: waits on "Parked until after launch in the merge plan (#93); #71 to be split after #55" (#93)

PRs that found a home in an existing item (merged or opened after 23 October):

- `ai-picker-connects` gains #90, #106, #110
- `reliable-ai` gains #135, #143
- `fn-reports` gains #144
- `in-app-updater` gains #96, #107, #136
- `windows-signed-updates` gains #97
- `win-fixes` gains #89
- `ci-checks` gains #105
- `perf-all-around` gains #141, #148, #149, #150, #151

Not tracked, because they are release, licence or docs chores rather than features: #40, #41, #94, #95, #98, #99, #100, #101, #102, #103, #104, #108, #113, #114, #115.

## How these were scored

- **Old:** each PR's state from `gh pr view` on getcurate/reel-studio on 5 November: merged, or open with the latest `reel-studio-bot` review's Blocking count and the CI rollup on its head. A replacement PR is scored itself, and both numbers are listed. An item takes the step of its least advanced open PR. A PR closed without merging leaves its branch, which scores 30. Judgment calls are in `tools/snapshot_1105.py` (`OLD_SET`), each with its reason.
- **New:** `git show`, `git grep` and `git merge-base --is-ancestor` on fork/redesign-beta at 41d4898, item by item; every row names a file, test or commit. Where beta holds an older head of a PR, I listed the commits it lacks (`git log --no-merges <pin>..<head>`): PRs that differ only by merges keep full credit. No item passes 80, because nobody has used a packaged build of the redesign.
- **Not run:** I ran no tests and no app. Test names prove a check exists on beta, not that it passes today. The Windows result comes from the 28 October batch 20 report.

## The five scores I'm least sure of

1. **Every item scored on an overnight replacement (#116 to #147).** Each replacement has no bot review yet, so the scale puts it at 50 even where the original sat at 70 with nothing Blocking (fn-transaction, pro-effects, drop-paste-airdrop, the Windows and install items). If the original's review counts for a clean rebase, those move back to 70.
2. **win-redesign-run new 80.** It rests on the Windows batch 20 report: every suite green on Windows 11 on win-tests-green, a branch off beta 4de5f6d that beta later merged. That is a development run, not an installed Windows build.
3. **Fork branches now count 30 in the old column.** The scale says 30 for a fork branch with no PR, so Instagram, TikTok, the learning loop, the cut vocabulary and multi-clip moved from 0 or 10 to 30. Most of those branches were made on or after 23 October; the old column moved because the branches exist, not because Aiden's app changed.
4. **reliable-ai new 60.** Every PR fix is in beta and tested, which reads as 80. I kept 60 because the item's own bar, a recorded live ChatGPT note, still hasn't happened.
5. **device-shapes new 60.** The picker came back through the preview-modes branch, not #3. I scored it against #3 because #3 is the item's PR and its 4 November SE subtitle fix isn't in beta; if the picker alone counts, it's 80.
