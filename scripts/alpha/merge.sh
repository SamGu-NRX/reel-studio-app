#!/usr/bin/env bash
# Rebuilds sg/alpha: origin/main plus every open fork branch, merged in a fixed order.
#
#   scripts/alpha/merge.sh            rebuild from scratch (fetches origin and fork first)
#   scripts/alpha/merge.sh --save     after resolving a new conflict by hand and committing the
#                                     merge, copy the recorded resolution into scripts/alpha/rr-cache
#                                     so the next rebuild replays it
#   scripts/alpha/merge.sh --no-fetch rebuild from the remote-tracking refs already fetched
#   BASE=<sha> scripts/alpha/merge.sh  build on that main commit instead of origin/main
#   PIN=file scripts/alpha/merge.sh   merge the exact SHAs in `file` (lines "branch sha", as the last run writes
#                                     to .git/sg-alpha-pins), to rebuild what was tested
#
# Textual conflicts are replayed with git rerere from scripts/alpha/rr-cache (committed, so a fresh
# clone replays them too). Fixes that are not textual conflicts, where both sides merge cleanly but
# the result is wrong, live in scripts/alpha/glue/*.patch and are applied with `git am` after the
# last merge. RESOLUTIONS.md says what each one does and why.
#
# rerere is switched on per command (-c), not in the shared repo config, so other worktrees of this
# repository keep their own merge behavior.
set -euo pipefail

BRANCH=sg/alpha
# BASE=<commit> builds on a fixed main (the PRs of a set are rebased on one main commit)
BASE=${BASE:-origin/main}
REMOTE=fork
ORDER=(
  repo-setup crash-diagnostics ai-guards cover-frame-streaming homebrew-cask mac-install security-fixes
  first-run-setup custom-server updater device-previews fullscreen-preview polish-pass eta cover-reasons
  change-at-moment player-smooth version-switcher note-atomic smooth-fps fix-home-reopen-note
)

top=$(git rev-parse --show-toplevel)
cd "$top"
rr_live=$(git rev-parse --git-path rr-cache)
rr_saved=scripts/alpha/rr-cache
G=(git -c rerere.enabled=true -c rerere.autoupdate=true)

die() { echo "merge.sh: $*" >&2; exit 1; }

[ "$(git symbolic-ref --short HEAD 2>/dev/null)" = "$BRANCH" ] || die "run this on $BRANCH (now on $(git symbolic-ref --short HEAD 2>/dev/null || echo detached))"

save_resolutions() {
  mkdir -p "$rr_saved"
  [ -d "$rr_live" ] || { echo "no recorded resolutions yet"; return; }
  local n=0
  for d in "$rr_live"/*/; do
    d=${d%/}
    [ -f "$d/postimage" ] || continue
    mkdir -p "$rr_saved/$(basename "$d")"
    cp "$d/preimage" "$d/postimage" "$rr_saved/$(basename "$d")/"
    n=$((n + 1))
  done
  echo "saved $n resolution(s) to $rr_saved"
}

if [ "${1:-}" = "--save" ]; then
  save_resolutions
  exit 0
fi

[ -z "$(git diff --name-only HEAD -- . ':!scripts/alpha')" ] || die "uncommitted changes outside scripts/alpha; commit or stash them first"
[ ! -e "$(git rev-parse --git-path MERGE_HEAD)" ] || die "a merge is in progress; finish it (git commit) or abort it (git merge --abort)"

if [ "${1:-}" != "--no-fetch" ]; then
  git fetch --quiet origin
  git fetch --quiet --prune "$REMOTE"
fi

# The last good build: where a moved branch's previous resolution is carried forward from (see carry_forward).
last_good=$(git rev-parse --git-path sg-alpha-last-good)
prev=$(cat "$last_good" 2>/dev/null || git rev-parse --quiet --verify "$REMOTE/$BRANCH" || true)

# A branch moved and rerere no longer matches: replay the previous resolution of each conflicted file with two
# 3-way merges, R_new = R_old + (HEAD_new - HEAD_old) + (branch_new - branch_old), taking R_old, HEAD_old and
# branch_old from that branch's merge commit in the last good build. Any overlap stops the script as before.
carry_forward() {
  local b=$1 m h_old t_old f tmp
  [ -n "$prev" ] || return 1
  m=$(git log --merges --format='%H %s' "$prev" | awk -v k="Merge $REMOTE/$b (" 'index($0, k) { print $1; exit }')
  [ -n "$m" ] || return 1
  h_old=$(git rev-parse "$m^1"); t_old=$(git rev-parse "$m^2")
  tmp=$(mktemp -d)
  for f in $(git diff --name-only --diff-filter=U); do
    git show "$m:$f" >"$tmp/r" 2>/dev/null && git show "$h_old:$f" >"$tmp/h0" 2>/dev/null &&
      git show "HEAD:$f" >"$tmp/h1" 2>/dev/null && git show "$t_old:$f" >"$tmp/t0" 2>/dev/null &&
      git show "MERGE_HEAD:$f" >"$tmp/t1" 2>/dev/null || { rm -rf "$tmp"; return 1; }
    git merge-file -q "$tmp/r" "$tmp/h0" "$tmp/h1" && git merge-file -q "$tmp/r" "$tmp/t0" "$tmp/t1" || { rm -rf "$tmp"; return 1; }
    cp "$tmp/r" "$f"
    git add "$f"
  done
  rm -rf "$tmp"
}

# Keep the current scripts/alpha (including uncommitted edits) across the reset.
keep=$(mktemp -d)
trap 'rm -rf "$keep"' EXIT
cp -R scripts/alpha "$keep/alpha"

mkdir -p "$rr_live"
if [ -d "$keep/alpha/rr-cache" ]; then
  cp -R "$keep/alpha/rr-cache/." "$rr_live/"
fi

git reset --quiet --hard "$BASE"
mkdir -p scripts
rm -rf scripts/alpha
cp -R "$keep/alpha" scripts/alpha
git add scripts/alpha
git commit --quiet -m "chore(alpha): integration merge script and recorded resolutions" \
  -m "sg/alpha is rebuilt by scripts/alpha/merge.sh; see scripts/alpha/RESOLUTIONS.md."

# Pin every branch now: other worktrees share these remote-tracking refs and fetch while this runs.
pins_out=$(git rev-parse --git-path sg-alpha-pins)
if [ -n "${PIN:-}" ]; then
  cp "$PIN" "$pins_out.tmp"
else
  : >"$pins_out.tmp"
  for b in "${ORDER[@]}"; do
    s=$(git rev-parse --verify --quiet "$REMOTE/$b^{commit}" || true)
    [ -n "$s" ] && echo "$b $s" >>"$pins_out.tmp"
  done
fi
pin_of() { awk -v b="$1" '$1 == b { print $2 }' "$pins_out.tmp"; }

status=()
for b in "${ORDER[@]}"; do
  ref="$REMOTE/$b"
  p=$(pin_of "$b")
  if [ -z "$p" ]; then
    status+=("$b|skipped: $ref is not pushed")
    continue
  fi
  sha=$(git rev-parse --short "$p")
  if git merge-base --is-ancestor "$p" HEAD; then
    status+=("$b|$sha|already contained")
    continue
  fi
  if "${G[@]}" merge --quiet --no-ff --no-edit -m "Merge $ref ($sha) into $BRANCH" "$p" >/dev/null 2>&1; then
    status+=("$b|$sha|clean")
    continue
  fi
  unresolved=$(git diff --name-only --diff-filter=U)
  how="replayed recorded resolution"
  if [ -n "$unresolved" ]; then
    # Conflicts that are only import lines resolve to the union of both sides' names (union-imports.py).
    # shellcheck disable=SC2086
    for f in $(python3 scripts/alpha/union-imports.py $unresolved); do git add "$f"; done
    left=$(git diff --name-only --diff-filter=U)
    [ "$left" = "$unresolved" ] || how="recorded resolution + import union: $(echo $unresolved | tr '\n' ' ')"
    unresolved=$left
  fi
  if [ -n "$unresolved" ] && carry_forward "$b"; then
    "${G[@]}" commit --quiet --no-edit
    save_resolutions >/dev/null
    status+=("$b|$sha|carried forward from the last good build: $(echo $unresolved | tr '\n' ' ')")
    continue
  fi
  if [ -n "$unresolved" ]; then
    echo "merge.sh: $b ($sha) has conflicts rerere has not seen:" >&2
    echo "$unresolved" | sed 's/^/  /' >&2
    echo "Resolve them, git add, git commit --no-edit, then run: scripts/alpha/merge.sh --save" >&2
    echo "and add a line to scripts/alpha/RESOLUTIONS.md. Then rerun scripts/alpha/merge.sh." >&2
    exit 2
  fi
  "${G[@]}" commit --quiet --no-edit
  status+=("$b|$sha|$how")
done

if compgen -G "scripts/alpha/glue/*.patch" >/dev/null; then
  for p in scripts/alpha/glue/*.patch; do
    if git am --quiet --3way "$p" >/dev/null 2>&1; then
      status+=("glue $(basename "$p")|$(git rev-parse --short HEAD)|applied")
    else
      git am --abort >/dev/null 2>&1 || true
      die "glue patch $p no longer applies; the branches it fixes changed. See RESOLUTIONS.md."
    fi
  done
fi

git rev-parse HEAD >"$last_good"
mv "$pins_out.tmp" "$pins_out"
echo
printf '%-34s %-9s %s\n' branch sha result
for s in "${status[@]}"; do
  IFS='|' read -r a b c <<<"$s"
  printf '%-34s %-9s %s\n' "$a" "$b" "${c:-}"
done
echo
echo "$BRANCH is at $(git rev-parse --short HEAD). Push with: git push --force-with-lease $REMOTE $BRANCH"
