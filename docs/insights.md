# Insights data

`insightsSummary(projectsRoot, { since, asOf })` reads each project's
`outcomes.json`, optional `trials.json`, and version `render.json` files. It
returns reels grouped by project and version, their platform posts, platform
and overall totals, weekly comparisons, and sentences with numeric evidence.
It never refreshes platform statistics or writes files.

Dates are ISO strings. `since` includes posts published at that instant. Without
`asOf`, the latest saved observation or publication sets the summary date, so
unchanged files and options return identical output. With no saved dates, the
start date or Unix epoch supplies that date. The `insights:get` IPC handler
supplies the current time unless the caller supplies `asOf`. The renderer calls
`reel.insights.get(options)` through the preload bridge. The main process owns
the Projects path; IPC accepts only date options.

## Numbers and comparisons

Counts sum the known values. `coverage` gives the number of posts reporting each
metric, so a partially known total is distinguishable from a complete one.
Unknown metrics stay `null`; zero remains zero. Summed reach can count the same
person across several posts or platforms.

Average watch time is weighted by plays and requires known plays and watch time
for every included post. The completion estimate divides average watch time by
rendered duration and caps the result at one. It estimates the average fraction
watched, not the percentage of viewers who finished. Missing duration leaves it
unknown. No completion-rate claim comes from this estimate.

Weeks begin Monday at midnight UTC. Weekly totals compare saved lifetime counts
for posts published in each week. They do not measure views gained during that
week. This week's incomplete publication window and the older posts' longer
exposure mean a difference cannot establish an audience preference.

Posts under 48 hours old are `still counting`. A snapshot collected before the
post reached 48 hours also keeps that label until statistics are refreshed.
These posts remain in overall totals but stay out of weekly comparisons,
rankings and comparison sentences. Mature posts with unavailable metrics remain
in weekly coverage, blocking comparisons that depend on their missing values.
No percentage change is reported against a zero baseline.

Trial records retain the project, array index, parent version, variable, and
before/after values. The current producer does not identify a posted child, so
these records provide context without a guessed winner.

## Sentence templates

Each sentence includes post references, its metric, current and baseline values,
the percentage difference where defined, and comparison groups. References join
to the returned posts for the raw numbers. Sentences never include project titles
or other arbitrary text. Platform and metric names come from fixed lists.

The sample and margin thresholds below are unvalidated heuristics. There is no
significance test or calibration study behind them.

| Template | Text | Trigger |
| --- | --- | --- |
| `no-data` | No post results yet | No posts in the requested interval. |
| `no-stats` | Post results are not available yet | Posts exist, but every requested metric is unknown. |
| `still-counting` | New posts are still counting | At least one post or saved sample is under 48 hours old. Evidence includes the age threshold. |
| `best-reel` | Your best reel has {plays} plays | At least two fully counted reels with complete play counts and at least 100 plays each. The largest summed play count wins. |
| `most-improved` | {Metric} improved most across weeks, up {percent}% | At least two settled posts in each week, complete coverage for that metric, a positive baseline, and at least 20% growth. The largest relative increase wins. |
| `shorter-held` | On {platform}, reels under 30 seconds held viewers {percent}% longer | Within a platform, at least two posts on each side of 30 seconds, each with 100 plays and known watch time and duration. Play-weighted watch time must be at least 20% higher for shorter reels. |
| `weekday-reach` | On {platform}, {weekday} posts reached the most people on average | Within a platform, at least two represented UTC weekdays, at least two posts per represented day, 100 plays per post, and known reach. The largest mean reach must exceed the runner-up by at least 20%. |

All expanded sentences have at most 12 words. Metric ties use stable metric
names; reel ties use project name then version. Weekday ties suppress a winner.
Corrupt files, unsupported schemas, conflicting post identities, and files
resolving outside their project produce `INSIGHTS_DATA`, rather than an empty
summary. Missing optional files are allowed; linked project folders are skipped.
