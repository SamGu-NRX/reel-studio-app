# sg/alpha: how each merge conflict is resolved

`scripts/alpha/merge.sh` rebuilds `sg/alpha` from `origin/main` and merges every open fork branch in a fixed
order. git rerere replays the textual resolutions below from `scripts/alpha/rr-cache/`. The patches in
`scripts/alpha/glue/` fix what merges cleanly but comes out wrong; the script applies them after the last merge.

When a branch moves and a conflict changes shape, the script stops and names the files. Resolve them with the
rule written here, `git add`, `git commit --no-edit`, run `scripts/alpha/merge.sh --save`, update this file,
and rerun.

The rule throughout is to keep both sides' intent. Branches named in a line are the ones merged earlier.

## Textual conflicts

In merge order. Lines that name a SHA were added when that branch moved and its conflict changed shape.

- mac-install-tests x crash-diagnostics, app/src/main/index.ts, start of `app.whenReady`: crash-diagnostics logs when the app runs from /Volumes or AppTranslocation; mac-install-tests returns early for `--self-test`. Kept both, logs first, so a self-test run from a disk image still logs where it ran from.
- dmg-install-window, app/src/main/index.ts, start of `app.whenReady`: the offer to move into Applications goes after the volume logs and the `--self-test` early return, so a headless self-test never shows the move dialog.
- onboarding-permissions, app/src/main/index.ts: imports are the union of both sides (mac-install-tests' `mkdtempSync`/`tmpdir`, crash-diagnostics' `isAbsolute`/`writeFileSync`, onboarding's `Notification` and permission modules, dmg's move-to-applications). Startup paths: kept mac-install-tests' `else if (SELF_TEST.selfTest)` throw-away userData and onboarding's test-only `REELSTUDIO_DOCUMENTS` override, in that order.
- onboarding-permissions, app/e2e/installed.spec.ts imports: union (mac-install-tests' `installedRuntime`, onboarding's `dirname` and `passMacStage`).
- custom-connectors, app/src/main/index.ts: startup switches. Kept the self-test userData and test Documents lines, then custom-connectors' test-only mock keychain switch.
- custom-connectors, app/src/renderer/src/components/connect.tsx, `ModelDownload`: speech-setup rewrote it (find an installed model first, Pause, "Keep downloading" in its own paused branch) and dropped the `onReady` prop its staged first run no longer uses; custom-connectors added `secondary` so Settings shows Download as a quiet button. Kept speech-setup's component and added only the `secondary` prop and class. The plain button says "Download", since the paused case already has its own "Keep downloading" button.
- auto-update, app/src/main/index.ts: auto-update replaces main's "update available" notice (`createUpdateService`) with the downloading updater (`createUpdater`). Took auto-update's updater wiring, speech-setup's `createModelManager({...})` options object, and the merged branches' imports. auto-update declared its own `const SELF_TEST = process.argv.includes('--self-test')`, which collides with mac-install-tests' `SELF_TEST = selfTestArgs(...)`; dropped it and use `SELF_TEST.selfTest`. At start: `await updates.init()`, `updates.start()`, then speech-setup's background speech check.
- auto-update, app/src/main/settings.ts: main's `UpdateState`/`UPDATE_DEFAULTS` are gone with the old notice; defaults are the union (`notifications`, `speechCheck`, `checkUpdates: true`).
- auto-update, app/src/preload/index.ts and app/src/shared/api.ts: kept onboarding's `perm` API and permission types; dropped main's `UpdateNotice`/`UpdateStatus`, which only the removed notice used.
- auto-update, app/src/renderer/src/components/ui.tsx: kept HEAD's `Modal` (polish/onboarding focus trap and `aria-labelledby`), which already has what auto-update added.
- auto-update, app/src/renderer/src/screens/Settings.tsx imports: kept `NotifyAccess`; dropped `RELEASES_URL`, unused once the old update card is gone.
- auto-update, packaging/sign-mac.sh, docs/signing-mac.md, packaging/README.md: step 5 builds the designed DMG with dmg-install-window's `make-dmg.sh`, then auto-update's update zip and `latest-mac.yml`. Docs and the README table describe both.
- fullscreen-preview, app/src/main/index.ts: window setup keeps fullscreen-preview's `setViewerFullScreen = viewerFullScreen(win)` and auto-update's menu "Check for Updates" callback on `installMenu`.
- fullscreen-preview, app/src/renderer/src/styles.css, reduced-motion block: kept custom-connectors' `.wizard-panel` fade and fullscreen-preview's no-transition rule.
- polish-pass, app/src/renderer/src/components/ui.tsx, `Progress`: speech-setup's `paused` class with polish-pass's `transform` fill (no layout per frame).
- polish-pass, ui.tsx, `Modal`: custom-connectors and polish-pass each added a Tab focus trap (an `onKeyDown` on the dialog, and a window `keydown` listener). Keeping both would move focus twice per Tab at the ends, skipping a control. Kept polish-pass's trap (it also handles a dialog with nothing to press, with `tabIndex={-1}`) and its wider `FOCUSABLE` (adds `summary`); kept custom-connectors' `labelledBy` prop and `aria-labelledby`.
- polish-pass, app/src/renderer/src/styles.css, toasts: polish-pass makes toasts without a close button ignore clicks (`.toast:not(.error)`); auto-update added info toasts with an action link ("Restart now") and a close button, marked `.closable`. With polish-pass's selector the update toast's buttons could not be clicked. Changed the selector to `.toast:not(.closable)` and moved the right padding to `.closable`, which covers errors.
- cover-reasons, app/dev/fake-engine/reelengine/__main__.py: command table has speech-setup's `speech-check` and cover-reasons' `cover-candidates`.
- cover-reasons, app/src/main/index.ts: imports union (`SettingsPane`, `CoverCandidate`, cover scan). `coverScans` is created next to speech-setup's `createModelManager({...})`; cover-reasons' side still carried main's old update notice, which auto-update removed, so that part is dropped. The export handler keeps auto-update's `exportsWriting` count (the updater won't restart mid-export), and cover-reasons' two cover handlers follow it.
- cover-reasons, app/src/renderer/src/screens/ShowMeHow.tsx, Cover tab: polish-pass shows the moment under the slider as a live video frame (`coverMoved`); cover-reasons adds the six suggestions (`CoverPicks`) and renames the slider heading to "Or pick any moment". Kept both: the preview, then the suggestions, then the slider.
- cover-reasons, app/src/shared/api.ts imports: both.
- change-at-moment, app/e2e/installed.spec.ts and mac.spec.ts imports: union (`passMacStage`, `installedRuntime`, `writeNote`).
- change-at-moment, app/src/main/index.ts imports: union (`NoteMoment`, `PlacedWord` with the cover and settings types).
- change-at-moment, app/src/renderer/src/App.tsx, sidebar "Connect one": hidden on the Reel screen (change-at-moment: the change button there is the connect prompt) and custom-connectors' `back` destination when shown.
- change-at-moment, app/src/renderer/src/components/Player.tsx: imports union (device-previews' caption fit, change-at-moment's marks); `onTimeUpdate` reports the time to `onTime`, and polish-pass's `onVolumeChange` stays.
- change-at-moment, app/src/renderer/src/screens/Reel.tsx: device-previews' `DevicePreview` frame wraps the player, which takes change-at-moment's `playerSrc` key, `marks`, `asking` and `onTime`; `ChangeAt` sits under the frame. "Optional extras": change-at-moment moved them to the bottom of the notes panel, so the old spot (with polish-pass's edits) is dropped here and glue patch 0001 re-applies polish-pass's and version-switcher's changes at the new spot.
- change-at-moment, app/src/renderer/src/styles.css, reduced-motion block: kept the wizard fade, the full-screen rule and the change pop-up's fade-only rule.
- player-smooth (stacked on an older change-at-moment), app/src/renderer/src/components/Player.tsx: imports union (fullscreen-preview's `FullScreenReel`, player-smooth's playhead store and video layers). The `<video>` is player-smooth's stacked layers (no remount on a version switch); polish-pass's `onVolumeChange` is added to the shown layer's handlers so the sound button follows the system volume control. fullscreen-preview still opens from `video.current`, which player-smooth points at the shown layer.
- player-smooth, app/src/renderer/src/screens/Reel.tsx: device-previews' frame wraps the player, which takes player-smooth's `playhead` store instead of the `onTime` callback and `playerSrc` remount key.
- version-switcher, app/src/main/index.ts, note job result: returns change-at-moment's `outcome` (for the scrub mark) and version-switcher's `made` (for the menu).
- version-switcher, app/src/main/jobs.ts: imports union; `JobFn` result has both `outcome` and `made`.
- version-switcher, app/src/renderer/src/components/Player.tsx: version-switcher plays a picked version with sound (`playRequest`). It relied on the player remounting per video; player-smooth no longer remounts, and loads the new video under the old one. The effect now waits until the requested video is the shown layer (`layers.shown?.src === src`, rerun on `shownId`), so it never unmutes and plays the old video. Kept player-smooth's per-frame playhead and change-at-moment's pause while asking.
- version-switcher, app/src/renderer/src/screens/Reel.tsx: imports keep `ChangeAt`/`noteMarks` and add `VersionSwitch`/`versionChanges`; dropped `AttachmentChips`/`useNoteAttachments` and version-switcher's `note` state, unused since change-at-moment moved the composer into the pop-up. The player gets device-previews' frame, player-smooth's `playhead`, and version-switcher's `freshPlay`/`playRequest`. "What I did" actions: hidden on an older version (version-switcher), greyed while working (polish-pass). Extras in the old spot are dropped (see glue 0001).
- ai-note-staging, ai/src/tools.ts: ai-input-guards checks a fetched picture with `requireAsset` and calls tools with `rawArgs`; staging makes a failed fetch end a note (`if (ctx.note) throw e`) and keeps tool summaries out of the chat during a note. Kept both.
- ai-note-staging, app/src/main/engine.ts: `error` handler: cover-reasons' `if (!child.pid) markGone()` first, then staging's abort return. `close` handler: crash-diagnostics' `exitSignal` and close log line, staging's `running.delete`/`markExited`, then the abort return, so a stopped engine's exit is still logged.
- ai-note-staging, app/src/main/index.ts imports: staging's `withProjectLock` plus the union.
- ai-note-staging, app/src/main/jobs.ts: imports union (`ENGINE_STOP_TIMEOUT_MS`, `ProgressKind`, version records, `settleNote`). Job start: staging's early `CANCELLED` throw first, then version-switcher's `existed`/`finals` bookkeeping.
- ai-note-staging, app/test/engine.test.ts: kept crash-diagnostics' signal and shutdown tests; the cancel test takes staging's new name and body.
- ai-note-staging, docs/schema-changes.md: both 2026-10-21 sections (`cover.manual`, `notes[].txnId`).
- ai-note-staging, docs/versions.md: staging rewrote the file and dropped the list where change-at-moment added its bullet; kept staging's text and moved change-at-moment's paragraph into its own section before "Publication" (same as the live test).
- ai-note-staging, engine/reelengine/cli.py and render.py, `cover-candidates`: takes cover-reasons' `--picker` and staging's `--project-file`/`--out`. `--out` wins; otherwise `work/cover-picker` or `work/cover-candidates` under the staged or live work folder.
- auto-update (feeb59d, keeps the old note's "Not now" and remembered release), app/src/main/settings.ts: imports `Dismissal`/`RememberedRelease` from update-machine with speech-setup's `SpeechCheckResult`; defaults add `updateLatest: null, updateDismissed: null`.
- auto-update x dmg-install-window (dcfcbd6, plain disk window when Finder can't lay it out), packaging/sign-mac.sh, docs/signing-mac.md, packaging/README.md: step 5 runs `make-dmg.sh` with `RS_DMG_PLAIN_REASON`, then the update zip; docs and the README rows carry both.
- player-smooth (69ba79d, now on the latest change-at-moment, adds "hold for original at the same moment"), Reel.tsx: the device frame wraps the player with player-smooth's `originalAt`/`warmOriginal`/`playhead`. app/src/shared/api.ts: imports union; `timeline` returns player-smooth's `segments`. change-at-moment put `wholeReelSetting` between `timeline`'s doc comment and `timeline`, so the comment described the wrong method; the merge puts each comment back on its own method.
- version-switcher (9e67215: Change links stay on older versions and switch to the latest first via `onLatest`; an older version's list loads on demand), app/src/main/index.ts and preload: the `versionChecklist` handler sits next to auto-update's export wrapper and cover-reasons' cover handlers. Reel.tsx: change-at-moment's timeline state and version-switcher's `older` loader are both kept; "What I did" actions use `onLatest(...)` and stay greyed while working (polish-pass). Player.tsx: same `playRequest` handling as above, after player-smooth's new hold-for-original code.
- change-at-moment (51c9a57: whole-reel settings keep the no-model fast path) x polish-pass, Reel.tsx: change-at-moment removes the note composer that polish-pass edited (attach button and placeholder while the AI check runs). Took change-at-moment's side: the composer lives in the change pop-up now. Reel.tsx still imports polish-pass's `NOTE_DROP_DONE`, now used only by `ChangeAt`; the unused import is harmless.
- speech-setup (e0ee092) and later change-at-moment: e2e imports (`listeningState`, `passListeningStage`, `writeNote`) are unioned by `union-imports.py`.
- ai-note-staging x version-switcher, app/src/main/jobs.ts job start: unchanged rule (abort check first, then version bookkeeping); rerecorded because the file's other hunks changed.

- auto-update (82ee299: automatic checks at most once a day, `updateCheckedAt`), app/src/main/settings.ts: auto-update now lists the update fields directly instead of spreading main's `UPDATE_DEFAULTS`, so the `update-check` import goes. Defaults are the union: onboarding's `notifications`, speech-setup's `speechCheck`, and auto-update's `checkUpdates`, `updateCheckedAt`, `updateLatest`, `updateDismissed`.

- custom-connectors x speech-setup (5eec35e: `onReady` is back, the timing check runs silently), connect.tsx `ModelDownload`: same rule as above. speech-setup's component and doc comment, with `onReady`, plus custom-connectors' `secondary` prop and class; the button says "Download".

- auto-update x speech-setup (770db10 and 5eec35e), app/src/main/index.ts: same rule as above, re-recorded because both sides changed. speech-setup's `createModelManager({...})` keeps its new `useThreads`, `gate: workGate` and `log`; auto-update's updater block follows it without its own `SELF_TEST`. At start: `await updates.init()`, `updates.start()`, then speech-setup's `models.checkInBackground()` 30 s later. The `update-check` import drops `createUpdateService`.

- cover-reasons x speech-setup (5eec35e), app/src/main/engine.ts, `runEngine`'s last parameter: both added a callback for when the engine process is gone (speech-setup's `onProcessExit`, cover-reasons' `onExit`). It is the same positional slot, so callers on both sides work with either. Kept cover-reasons' `onExit` behind `markGone()`, which calls it exactly once; speech-setup's version could call it from both `error` and `close`.

- cover-reasons (06db86b), app/src/main/index.ts: same rule as above, re-recorded: `coverScans` after speech-setup's model manager and before auto-update's updater block; the cover handlers after auto-update's export wrapper.

- change-at-moment (8f9a860) x polish-pass (4085a56: files dropped on the note box before the AI check answers are held, then attached), Reel.tsx: same rule as above. change-at-moment removes the note box, so polish-pass's held drops, its "Checking for your AI editor…" placeholder and the old-spot extras go with it; device-previews' frame wraps change-at-moment's player and `ChangeAt` sits under it. polish-pass's wait-for-the-AI-check behavior has no counterpart on `ChangeAt` yet (REPORT.md, integration bugs).

- player-smooth (084ee43: hold for the original at the same moment, an always-present "Original" status line), Player.tsx and Reel.tsx: same rules as above, re-recorded. Player.tsx keeps player-smooth's layers with polish-pass's `onVolumeChange` on the shown layer, then player-smooth's `original-tag` status line followed by fullscreen-preview's Full screen button and view. Reel.tsx: device-previews' frame wraps player-smooth's player (`originalAt`, `warmOriginal`, `playhead`, `onShown`).

- version-switcher (5748ea8) on the newer player-smooth and change-at-moment, Reel.tsx: same rules as above, re-recorded. polish-pass 4085a56's effect that attaches held drops (`heldDrops`, `att`) merges cleanly but reads the note box that change-at-moment removed, so it goes with the note box.

- ai-note-staging (e628284) on the newer heads, re-recorded by replaying the previous resolution of each file: ai/src/tools.ts takes ai-input-guards' `requireAsset` check with staging's new rule (692a537): a stop or any error that is not a `ToolInputError` ends the note, input errors go back to the model. engine.ts takes staging's log line for a result that arrived before an abnormal exit. index.ts: the note job takes the job id and `onStaging` (staging) and sends `aiNoteText(note, moment)` (change-at-moment); `createJobManager` gets staging's job-scoped `toVideo` and speech-setup's `workGate`; `handleMediaProtocol` gets staging's `noteVideos.roots`; `withProjectLock` now comes only from `./ai`. jobs.ts: `JobFn` takes staging's `jobId` and returns version-switcher's `outcome`/`made`; the render event records `finals` (version-switcher) and sends only while the job is live (staging). engine.test.ts keeps both sides' shutdown tests and staging's cancel test. docs/versions.md: staging's text with change-at-moment's current paragraph in its own section.

- ai-note-staging, app/src/main/media.ts: staging's thin version (serving moved to media-file.ts). Glue patch 0002 carries cover-reasons' checks over.

- change-at-moment (3a815d5: the phone takes the column's leftover height, `.phone-slot`; the change button waits for the AI check, `change-checking`) x device-previews, Reel.tsx: resolved as in /tmp/rs-evidence/change-at-moment/merge-device-previews-resolution.patch. device-previews' `DevicePreview` frame wraps change-at-moment's player (`key={playerSrc}`, `marks`, `asking`, `onTime`), inside #18's `phone-slot` here; glue 0002 then moves the slot inside DevicePreview. `ChangeAt` sits under it with #18's `checking={!providerChecked}`. The note box, its held drops (polish-pass) and the old-spot extras go, as before; the now-unused `NOTE_DROP_DONE` import goes too.

- change-at-moment (3a815d5) x polish-pass (4085a56), app/e2e/design.spec.ts, "AI check that has not answered": polish-pass checks that the reel opens and plays within a second while the check is pending, then that the note box waits and holds a dropped picture; #18 checks that the change button reads "Checking for your AI editor…", is disabled, and that no connect prompt shows. Kept polish-pass's open-at-once checks and #18's change-button checks; polish-pass's note-box and held-drop steps go with the note box, and so does its now-unused `dropFiles` import.

- player-smooth (6fbbd91, rebased on change-at-moment 3a815d5), Player.tsx: same rule as above. player-smooth's layers with polish-pass's `onVolumeChange` on the shown layer; player-smooth's always-present `original-tag` status line, then fullscreen-preview's Full screen button and `FullScreenReel`.

- version-switcher (e4f54c4: "In the latest version" shows the newest version's length, from a per-video `lengths` map) on the newer player-smooth and change-at-moment, Reel.tsx: same rules as above. `lengths` replaces the single `duration` state, and the player's `onDuration` fills it; player-smooth's `warmOriginal` and change-at-moment's timeline effect stay, with version-switcher's `latestN`/`older` after them. The player keeps glue 0002's slot and device frame, player-smooth's props, and version-switcher's `freshPlay`, `playRequest` and `onPlayRequestHandled`. "What I did" actions: `onLatest(...)`, greyed while working. version-switcher's `note` state and old-spot extras go, as before. Player.tsx was carried forward by merge.sh.

- ai-note-staging (63f6de0: file serving back in main's media.ts with a staging hook, `lockProjectEngine` wrapper) x speech-setup and change-at-moment, app/src/main/index.ts: `createJobManager` gets staging's job-scoped `toVideo` and speech-setup's `workGate`; the note job takes staging's job id and `onStaging` and sends change-at-moment's `aiNoteText(note, moment)`; `handleMediaProtocol` gets staging's `noteVideos.roots` and speech-setup's `setAsrThreads` line follows it. media.ts and live.test.ts merge into cover-reasons' checks plus staging's `allowStagingMedia` hook, with no hand edits.

- fix-sign-mac-exec, fix-home-reopen-note, fix-e2e-temp-cleanup: clean.

## v4 set (2026-10-21)

repo-setup replaces ci-checks, repo-baseline, engine-cache-isolation and fix-e2e-temp-cleanup; note-atomic
replaces ai-note-staging; smooth-fps is new. Lines above that name only the replaced branches stay as history.
repo-setup, smooth-fps and note-atomic sit where the branches they replace were (smooth-fps right after
note-atomic). repo-setup merges clean.

- change-at-moment (9952ca3: main's note box is back beside the change button) x polish-pass and device-previews,
  Reel.tsx: device-previews' frame wraps the player inside #18's phone slot (glue 0002 moves the slot), as
  before. With the note box back, polish-pass's behavior for it comes back too: files dropped before the AI check
  answers are held (`heldDrops`, `held` added to the busy chips), the attach button and paste wait for the check,
  and `send` refuses until it answers. #18's note box is replaced whole by "Connect an AI editor to ask for
  changes" when no AI is on, so its plain `composer` class and its two-state placeholder win over polish-pass's
  `no-ai` class and three-state placeholder. Old-spot extras go (glue 0001).
- change-at-moment x polish-pass, app/e2e/design.spec.ts: #18's checks (change button and note box wait for the
  AI check, no connect prompt) with polish-pass's open-at-once checks and, now that the note box is back,
  polish-pass's held-drop steps and its `dropFiles` import.
- player-smooth (a55e47e), Reel.tsx: player-smooth's playhead store replaces #18's `playhead` state; polish-pass's
  held-drop state stays.
- version-switcher, Reel.tsx: same rules as before (`lengths`, `freshPlay`, `playRequest`, `onLatest`, greyed
  actions). #18 and #19 both declare `note` state; the identical lines merge into one.
- note-atomic x cover-reasons and the v3 set, docs/schema-changes.md: both 2026-10-21 sections (cover picker,
  all-or-nothing notes).
- note-atomic x accurate-eta, app/test/live.test.ts: both tests (#16's estimate after an overrun, note-atomic's
  one lane per video).
- note-atomic x cover-reasons, engine/reelengine/cli.py and render.py, `cover-candidates`: takes both
  cover-reasons' `--picker` and note-atomic's `--project-file`.
- note-atomic x change-at-moment, app/src/main/store.ts `addChat`: note-atomic's `stamp()`, with #18's `moment`
  and the id #18 returns to its caller (the note's mark) kept as the line's id.
- note-atomic x crash-diagnostics and cover-reasons, app/src/main/engine.ts `close`: crash-diagnostics' close log
  line, then note-atomic's wait for the whole process group (`gone`): a group that is still alive fails as
  ENGINE_STUCK first, then any result that arrived resolves (main's rule, which crash-diagnostics kept), then
  errors and crash-diagnostics' signal-aware ENGINE_CRASHED. cover-reasons' run-once flag for `onExit` is renamed
  `exited`, because note-atomic's `gone` promise now has that name in the same scope.
- note-atomic x change-at-moment, version-switcher and accurate-eta, app/src/main/jobs.ts: `JobFn` gets
  note-atomic's third argument (`{ id, owner }`) and returns the union of both results (`chat` and `quiet`,
  #18's `outcome`, #19's `made`). Progress keeps #16's switchable `progressKind` with note-atomic's `open` flag
  and `owner`. On success one app.json update clears the job, settles #18's note mark and posts note-atomic's
  chat lines (none when `quiet`); #19's version record follows and, like any bookkeeping after the work is saved,
  is logged rather than failing the job.
- note-atomic x change-at-moment, speech-setup, onboarding-permissions and accurate-eta, app/src/main/index.ts:
  the note job takes note-atomic's id, owner and `saveStyleRules: false` and sends #18's `aiNoteText(note,
  moment)`. #18's mark is "done" when the version went up or note-atomic's `changed` is non-empty, since a
  caption-only note keeps its version number (docs/versions.md). `projects:update` runs through note-atomic's
  `jobs.hold`; #18's `projects:timeline` handler stays. Re-renders pass note-atomic's `owned(...)` arguments with
  HEAD's whole-job `aggregate` progress. At start, onboarding's permission setup stays and the folder is still
  left alone before first run; note-atomic's `clearStaleLocks()` runs inside the `firstRunDone` branch, between
  `ensureRoot` and `recoverInterrupted`.
- note-atomic c85059c (PR #29: the crash-recovery registry keeps an engine until its whole group is gone),
  engine.ts: `onSpawn` gets the project; the registry's `onExit` moves from `close` to after the group has
  ended, while cover-reasons' per-call `markGone` stays at `close`. index.ts: c85059c's reap (`stillRunning`,
  `keepClosed`) goes where the reap was, after dmg-install-window's move offer; onboarding's `firstRunDone`
  branch passes `stillRunning` to `clearStaleLocks` and the closed slugs to `recoverInterrupted`.
  app/test/orphans.test.ts (repo-setup and c85059c both edit it) was carried forward by merge.sh.
- smooth-fps x note-atomic, index.ts: `init` gets `--faster-exports` inside note-atomic's `owned(...)` list, with
  the source files last. settings.ts: auto-update's defaults list plus `fasterExports: false`.

Not fixed here (a design call, reported in REPORT.md v4): cover-reasons' cover picker scan runs `cover-candidates`
without `--owner`, and note-atomic's engine refuses that while the project's job holds `work/.owner.lock`. Opening
the Cover tab while a note runs then shows no suggestions ("Pick any moment below").

## v5 set (2026-10-21): the rebuilt PRs, on main 8f61817

`BASE=8f61817 PIN=<pins> scripts/alpha/merge.sh --no-fetch`: the PRs are rebased on 8f61817, and origin/main has
moved on (740c266). mac-install replaces mac-install-tests, dmg-install-window and fix-sign-mac-exec; security-fixes
is new and owns media serving; ai-guards, eta, updater and custom-server replace ai-input-guards, accurate-eta,
auto-update and custom-connectors; first-run-setup replaces onboarding-permissions and speech-setup. The lines above
that name the replaced branches stay as history; the same rules carried over unless a line below says otherwise.

- mac-install x crash-diagnostics (b398a81), index.ts start of `app.whenReady`: crash-diagnostics' /Volumes and
  AppTranslocation log lines first, then the `--self-test` early return and the move-to-Applications offer.
- security-fixes x mac-install, index.ts: `SELF_TEST` and security-fixes' `rendererUrl`, both.
- first-run-setup x mac-install, index.ts startup paths: the self-test's throw-away userData, then the test-only
  Documents folder. installed.spec.ts imports are unioned.
- custom-server x first-run-setup, index.ts: plus custom-server's test-only mock keychain switch. connect.tsx:
  first-run-setup's model download (`useModelStatus`, `ModelPanel`); custom-server's `secondary` prop is passed down
  to the Download button, which says "Download" (the paused state has its own "Keep downloading").
- updater x first-run-setup, custom-server and mac-install:
  - jobs.ts `createJobManager`: first-run-setup's work gate stays 5th, updater's `assertCanStart` is 6th.
  - index.ts: the job manager gets `workGate` and `() => updates.assertCanStartWork()`; first-run-setup's
    `createModelManager({...})` options stay; the updater's setup replaces main's update notice
    (`createUpdateService` and its import go) without its own `SELF_TEST` (mac-install's is used, glue 0003). At
    start: `await updates.init()`, `updates.start()`, then first-run-setup's background speech check.
  - ui.tsx Modal: the updater's dialog (inert background, Tab trap) with custom-server's `labelledBy`.
  - api.ts: first-run-setup's permission API and types stay; main's `UpdateNotice`/`UpdateStatus` go.
    signing-mac.md step 5: mac-install's designed disk window, then the updater's zip and `latest-mac.yml`.
  - Settings.tsx was replayed from the recorded resolution.
- fullscreen-preview, styles.css reduced-motion block: the updater's and full screen's rules, both.
- polish-pass x updater, ui.tsx: `Progress` keeps first-run-setup's `paused` class with polish-pass's transform
  fill. `Modal`: the updater's inert background stays; of the two Tab traps (the updater's `onKeyDown` and
  polish-pass's window listener) only polish-pass's is kept, so Tab moves focus once; polish-pass's
  `FOCUSABLE`, `tabIndex={-1}` and focus fallback, custom-server's `aria-labelledby`.
- cover-reasons x security-fixes: media.ts, media-allow.ts and media.test.ts are security-fixes' (it took #17's
  linked-roots part and adds the allowed-root check); library.ts keeps #17's doc comment on `libraryMediaUrl`.
- change-at-moment, App.tsx: "Connect one" is hidden on the Reel screen (#18), with custom-server's back
  destination (see glue 0003). styles.css reduced-motion block: all of the updater's, full screen's and the
  change pop-up's rules.
- note-atomic x crash-diagnostics (b398a81), engine.ts: as before, plus crash-diagnostics' `stopping` set: Stop
  still settles only once the whole group has ended (note-atomic), and that stop is registered so shutdown
  (`killAllEngines`) waits for it. jobs.ts: as before, with the updater's `assertCanStart()` before note-atomic's
  `refuseIfBusy`. live.test.ts: eta's estimate-after-overrun test and note-atomic's one-lane test, both.
- smooth-fps (5424fe6), Settings.tsx: the updater's `useUpdateState` and smooth-fps' faster-exports toggle; main's
  `checkUpdates` status, which smooth-fps carried, goes with main's old update card.
- fix-home-reopen-note (25bbd2f): clean.

## Glue patches (clean merges that come out wrong)

- `0001-extras-at-new-spot.patch`, app/src/renderer/src/screens/Reel.tsx: change-at-moment moved "Optional
  extras" to the bottom of the notes panel. polish-pass greys them while a version is made instead of hiding them,
  and version-switcher makes them act on the latest version (`onLatest`) when an older one is on screen. Both edits
  were at the old spot, so the merge dropped them without a conflict. The patch puts both back at the new spot.
  Still needed: #12, #18 and #19 are each based on main, so no single PR can carry it.

- `0002-phone-slot-around-device-frame.patch`, DevicePreview.tsx and Reel.tsx: change-at-moment gives the phone
  the height the rows under it leave (`.phone-slot`); device-previews draws a frame and then its device picker.
  The slot goes around the frame only, inside DevicePreview, so the picker stays a row below (the `.phone-slot`
  comment in styles.css, from 3a815d5). From /tmp/rs-evidence/change-at-moment/merge-device-previews-slot-placement.patch.

Glue 0001 is still needed in v4: #18 9952ca3 still hides the extras while working and has no `onLatest`.

- `0003-type-fixes.patch` (v5): what the combined branches need to typecheck. The updater's environment reads
  mac-install's `SELF_TEST.selfTest`; updater.test.ts passes the work gate slot; security-fixes' media response
  casts `Readable.toWeb` to `ReadableStream` as main did (with the updater's dependencies the global stream types
  differ); App.tsx drops custom-server's Reel branch inside "Connect one", which #18 hides on the Reel screen.

- `0004-cover-scan-owner-token.patch` (v5): cover-reasons' picker scan joins a running job with its owner token.
  note-atomic's engine refuses a project command without `--owner` while a job holds `work/.owner.lock`; the job
  manager now keeps each open project's token (`ownerToken`) and the scan passes it with `owned()`. cover-candidates
  stays under note-atomic's ownership rule (no exemption). app/test/owner-token.test.ts pins the token.

Retired in v3, because the PR now covers them:

- media checks in staging's `serveMedia` (old 0002): ai-note-staging 63f6de0 removed media-file.ts and keeps main's
  media.ts with a staging hook, so cover-reasons' real-path and Library-link checks merge in unchanged.
- forward the engine exit callback (old 0003): ai-note-staging 63f6de0's `lockProjectEngine` passes every argument
  to the runner, and the runner calls `onExit` itself when a stopped run never started (engine.ts, `signal?.aborted`
  before spawn).

## When branches move

- rerere matches a conflict by its exact text, so a branch that moves often produces a new conflict.
- `union-imports.py` resolves conflict blocks that are only `import` lines.
- If that isn't enough, `carry_forward` in merge.sh re-applies the file's resolution from the last good build,
  plus what changed on each side since then. It stops when those changes overlap.
- Each run pins every branch's SHA at the start, because other worktrees fetch the same remote-tracking refs mid-run.
  The pins are written to `.git/sg-alpha-pins`; `PIN=.git/sg-alpha-pins scripts/alpha/merge.sh --no-fetch`
  rebuilds exactly what was tested.
