# Versions and previews (contract between engine, ai and app)

Decided 2026-10-17 (polish stream). Goal: the user sees v1, v2, v3 for edits they can export,
never a pile of preview-only folders an AI run left behind.

## On disk

```
<project>/versions/
  v1/            a VERSION: export.mp4 + cover.png + verify.json + render.json + project.json (+ notes.md)
  v2/
  preview/       the ONE scratch folder for previews, overwritten every time:
                 draft.mp4, window_<a>-<b>.mp4 (only the latest window), cover.png, verify.json,
                 render_draft.json, project.json
```

Rules:

1. **Only a final render (`render` without `--draft`/`--window`) creates or fills `versions/vN/`.**
2. **Every `render --draft` and every `render --window a:b` writes into `versions/preview/`**,
   replacing what was there (a new window deletes the previous `window_*.mp4`). It never creates a
   `vN` folder and never changes `project.json`'s `version`.
3. `project.json` `version` = the last FINAL version number.
4. A final render re-uses `vN` when the edit is unchanged since `vN` was rendered (re-rendering the
   same edit overwrites it); otherwise it makes `v(N+1)`.
5. `cover` (cover only) writes into `vN` when that edit already has its `export.mp4`, else into
   `preview/`.
6. `frames` reads the newest full render, preview or final (never a window slice).

## Render result (engine `done.result`)

| field | meaning |
|---|---|
| `version` | final: the version written. Preview: the number this edit WILL get when it is finalised |
| `preview` | `true` for drafts and windows (file is under `versions/preview/`) |
| `versionDir` | absolute folder the files went to |
| `file` | absolute path of the mp4 |
| `broll` | b-roll items shown differently than asked (`fallback`, `shownAs`) or skipped (`skipped`) |

## What the app shows

- **Version chips** = folders matching `^v\d+$` that contain `export.mp4`, sorted by number.
  Folders without `export.mp4` (from older builds, or an AI run whose final render failed) are
  not shown.
- **While an AI run is working**, the player may show `versions/preview/draft.mp4` (the `render`
  event with `draft: true`).
- **`AgentResult.version`** is the version to select after a run. In the rare case its folder has
  no `export.mp4` (a first edit's final render failed and the run fell back to its preview of the
  same edit), show `versions/preview/draft.mp4` and offer to try the final render again. A note
  never falls back: when its final render fails, the note is undone and the run fails.
- `versions/vN/notes.md` (written by the ai package) is the note text for that chip.

## ai package

- `render_draft` = engine `render --draft` (preview). The agent caps previews per task (3 per first
  edit, 2 per note).
- After the agent calls `finish`, the loop runs one final `render`: that is the only step that adds a
  version.
- A note is all-or-nothing. Before its first change the ai package copies `project.json` and
  `work/assets/credits.json` into `work/.note-in-progress/` beside a marker. As the note's tools create
  files (downloads, screenshots, animations, the final render's `vN` folder) and My style rules, each is
  recorded in the marker; the preview from before the note is moved beside it before the note's first
  preview. A note that fails, or that the app closed in the middle of, is undone from exactly that record:
  nothing else in the project is touched. A note that re-uses a version folder (an edit that renders the
  same video) records the old bytes of `notes.md` there first. The marker also holds the project id, the
  project folder's real path and the copy's sha256, and may only name files a note can make (one file in
  `work/assets` or `work/thumbs`, a `vN` folder or a file in one); recovery removes a marker that does not
  match or is malformed, restores nothing and logs why. Deleting the marker is the commit point. The app calls `recoverNote` at
  startup for a cut-off note job; `applyNote` calls it too. A note job whose `txnId` is already in
  `project.json` `notes` was saved before the app closed and is not asked for again.
