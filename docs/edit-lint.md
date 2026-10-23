# Edit lint

The AI editor receives deterministic feedback before a draft is encoded. `lint_edit(edit, timeline)` takes the resolved output timeline, reads no files, changes neither input, and returns `{fixed, issues}`. Media planning and beat analysis happen before that call. An issue contains `rule`, `at_seconds`, `message`, and `suggestion`.

`reelengine lint-edit --project <folder>` plans and checks an edit without encoding it. The AI tool `lint_edit` exposes that command. Engine renders run the same check and apply the repairs to their render plans; `render_draft` returns `fixed` and `issues` beside `visualChanges`, including when it reuses a preview. Repairs do not rewrite the saved project or move kept words, captions, or picture cuts.

| Rule | Result | Condition |
| --- | --- | --- |
| `join-room` | Repair | A requested J/L handle exceeds the source and output room calculated by the cut planner. Keep only the available whole frames. |
| `beat-snap` | Repair | A proposed beat adjustment crosses a shot or another event, or violates a neighbour's required spacing. Keep the original event time. |
| `zoom-ramp` | Repair | Entrance and release exceed the visible frame span. Shorten entrance first, then fit the release in the remaining frames. |
| `visual-dwell` | Issue | A picture or overlay is visible for less than 1.2 seconds. |
| `framing-dwell` | Issue | A framing lasts less than 2 seconds. |
| `jl-budget` | Issue | J/L join count exceeds the chosen preset's reel budget. |
| `smash-budget` | Issue | Smash count exceeds the chosen preset's reel budget. |
| `sfx-budget` | Issue | Cut-anchored effects, including implicit smash hits, exceed the preset budget. An explicit replacement counts once. |
| `join-beat` | Issue | A beat accent lands within one output frame of a J/L join. |
| `successive-zooms` | Issue | Two zooms start without a shot cut or overlay start between them or at the second start. |
| `caption-band` | Issue | A caption box extends outside the existing platform-safe vertical bounds. |
| `cadence` | Issue | The average visual hold, including releases to wide framing, lies outside the preset band. Punchline has no cadence band. |

Projects without `cutStyle` receive the generic timing, clash, dwell, and caption checks. Preset budgets and cadence need a style. The thresholds reuse the product's chosen starting values; they have not been validated by an output-quality study.

Beat planning already rejects neighbouring-event and shot-boundary violations. Lint keeps an independent check over the proposed times and records these rejected candidates in `fixed`. A legal snap stays snapped and produces no repair. Named zooms, seeded framing, ramp variation, and J/L offsets share one resolved edit and one local seeded generator. The engine preset table supplies zoom defaults; its TS mirror is checked by schema-parity tests.
