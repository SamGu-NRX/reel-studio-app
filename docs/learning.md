# Suggestions from post results

After insights refresh has finished writing `outcomes.json`, the app can run:

```sh
reelstudio-ai learn --projects-root "<Reel Studio root>/Projects"
```

This command needs no provider, network access or model. It scores saved trials and calls `StyleStore.propose` to queue suggestions in the sibling `My style.json`. Its JSON response contains each proposal and the store's status. Existing and forgotten rules produce no new proposal. Repeating the command leaves pending suggestions unchanged. The queue holds at most three suggestions; none enters `rules` or the editor's prompt.

Library callers can use `learn(projectsRoot)` for read-only `ProposalDraft[]` output, then pass drafts to their existing `StyleStore.propose`. The optional second argument supplies that store when its root differs from the Projects parent. No refresh trigger or UI is installed by this slice.

## Decision rule

The provisional paired-agreement rule requires both posts to reach at least 300 people. A win needs average watch time at least 1.15 times the parent's and `(saves + shares) / reach` at least 1.10 times the parent's. At least three independent pairs must win, and wins must account for at least 75% of eligible pairs. A ratio at or below the reciprocal threshold in either metric vetoes a suggestion. Zero results count as losses; zero baselines and missing metrics cannot supply finite ratios.

There is no evidence yet for these thresholds. They exclude small audiences, small differences and isolated wins by heuristic. They do not estimate statistical noise, establish significance or control for audience and publication time. The suggestions describe observed associations.

Brightness comparisons pool by the tested 8% increase or decrease. If both directions qualify, neither is proposed. Caption comparisons pool exact text transitions. Hook word IDs, cover source times and random seeds only identify choices within a project, so their exact transitions stay scoped to that project. A random seed alone cannot establish a general editing preference. Different arbitrary choices never count as repeated evidence for the same rule.

## Joining and tracing evidence

The trial writer records the parent version but omits the child version. The scorer considers the next numbered final version only when both saved project snapshots match the recorded `from` and `to`, and every other edit field matches. A later unrelated edit, missing snapshot or unrendered trial supplies no evidence. Bookkeeping fields `version`, `createdAt`, `updatedAt` and `notes` do not affect this comparison.

Each version needs exactly one observed Instagram post, and both posts must belong to the same account. Multiple posts are ambiguous because trials do not assign post IDs. A post cannot supply more than one pair for the same preference, even if rows or project folders duplicate it.

Evidence includes the number of agreeing and eligible pairs, the arithmetic mean of their watch-time ratios and action-rate ratios, and a link for every eligible trial. Links are relative to Projects; `reel-slug/trials.json#/2` points to array element 2. Version numbers and both post IDs identify the saved outcomes behind the comparison. `from.change` is the mean watch ratio minus one, and `from.n` is the eligible pair count.

The store gives proposals stable IDs from normalized rule text. Dismissal records both the ID and normalized text, and removing an active rule records its text too. Internal rollback uses `{ forget: false }` because an interrupted edit is not a user decision. Ordinary rule writes preserve pending proposals and forgotten entries. Unreadable memory data causes an error without replacing the file.
