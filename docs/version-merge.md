# Combining saved versions

`createAI(...).mergeVersions(projectDir, { ours, theirs, take }, onEvent)` saves a new version without a model. Both numbers must name finished versions of this project. Every layer needs an explicit `ours` or `theirs` choice. There is no ancestor search or automatic conflict resolution in this slice.

The pure `mergeVersions({ ours, theirs, take }, transcript)` export accepts loaded snapshots and returns `{ edit, report }`. It copies its inputs and has no clock or random values. The transcript is required because word ids do not encode their position or source. The saved-version method adds the normal job result, including `version`, to that result.

## Field ownership

Whole objects and arrays include their extension fields. A field absent on the chosen side stays absent.

| Layer or retained state | Exact fields | Source |
|---|---|---|
| cut | `cut` in full, including `keep`, `gapCap`, `minSaving`, and cut provenance; `sources` in full, including mirror flags; `format`; `transcript` | Selected cut side. These describe the footage and coordinate system the cut uses. |
| captions | `captions` in full, including `enabled`, `style`, text `corrections`, word-anchored `hidden`, and `vocabulary` | Selected captions side. |
| music | `music` in full, including `enabled`, `track`, `startAt`, `level`, `automation`, and `fadeOut` | Selected music side. |
| zooms | `zooms`, including each item's `anchor`, `scale`, and extension fields | Selected zooms side. |
| broll | `broll`, including each item's `id`, `anchor`, `leadIn`, `treatment`, `asset`, `assets`, `params`, and extension fields | Selected broll side. |
| sfx | Optional `sfx` array, each item carrying an `anchor`, optional `id`, `asset`, and extension fields | Selected sfx side. This base preserves this data but does not render sound effects. |
| cover | `cover` in full, including `atSourceTime`, `source`, `text`, and `exact` | Selected cover side. Raw-source time remains valid even when the cover frame is outside the cut. |
| Post text | `post` in full | Ours. Saving refreshes existing image credits through the ordinary note path. |
| Identity and history | `id`, `slug`, `title`, `createdAt`, `updatedAt`, `version`, `notes`, `handEdits` | Live project when saving. The pure helper starts from ours. The save advances the counter, adds its note, and updates the timestamp. |
| Other project fields | `schemaVersion` and all remaining top-level fields | Ours, preserved without reinterpretation. |

`ai/src/version-merge.ts` uses `MERGE_FIELDS` to select fields and build the tool's required choices. Adding an editable top-level field requires assigning its layer here and in that map.

## Words removed by the cut

The selected cut defines the kept words and their output order. Missing transcript anchors are errors. Removed words are different: their ids still exist in the transcript, so the following rules apply.

- Captions are generated from the kept words. Style, vocabulary, and text correction rules stay intact. A correction is a global text replacement in this base, not a word-id range. Hidden caption ranges intersect the kept words and split at removed words, source changes, or reorders. Empty ranges are dropped.
- Zooms and music volume ranges use the same intersection rule. Each surviving range retains the original scale or gain.
- B-roll and sound effects keep their starting word. If it was removed, drop the item. Otherwise end the item at the first break in its surviving source span. Do not restart an animation or a sound later in the cut.
- Each removed or shortened item gets a plain sentence in `report`, in captions, music, zooms, b-roll, then sound-effect order. Item order within each layer remains stable.

Snapshots on this base do not contain their own transcripts. The merge refuses missing ids but cannot detect an old word id that re-transcription reused for a different word. Transcript history remains separate work. This base has no caption split/join fields to reconcile.

## Saving and callers

The save takes the existing project edit lock, loads the saved snapshots, and stages the merged edit under `work/notes`. It renders with `--parent ours --merge-parent theirs`. The engine always allocates the next version for a merge, even if the picture matches the newest saved render. Before publication it writes:

```json
{ "parent": 2, "parents": [2, 1] }
```

`parent` remains ours for old readers. New app readers also expose `parents`. Invalid ancestry is an error; legacy versions retain the linear fallback.

The existing note transaction completes the snapshot and `notes.md`, then replaces the live project only if its original bytes still match and the job was not stopped. Ordinary failure removes the unpublished next version. Saved versions are never rewritten.

`reel.projects.mergeVersions(slug, request)` invokes `projects:mergeVersions` and returns the job id. It uses the existing app job lane and needs no AI connection. The result summary includes the adjustment report.

The AI tool `merge_versions` stages the same operation inside its current note. It does not publish independently; the note must finish and pass the same save checks. The prompt offers it only when the user asks to combine versions. The renderer's version-selection UI is separate work.
