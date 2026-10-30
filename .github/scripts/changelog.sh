#!/usr/bin/env bash
# Markdown changelog for one component, from conventional commits that touched its folder.
#
#   changelog.sh <tag-prefix> <path> <current-tag>
#   changelog.sh addon-v apps/addon addon-v0.2.0
#
# The range is "previous tag with the same prefix .. current tag" (or the whole history for the first release).
# Needs full history and tags (actions/checkout with fetch-depth: 0).
set -euo pipefail

prefix="$1"; path="$2"; current="$3"

# Highest earlier tag with this prefix, by version order (pre-releases are not special-cased).
prev="$(git tag --list "${prefix}*" --sort=-v:refname | grep -vxF "$current" | head -n 1 || true)"
range="$current"
[ -n "$prev" ] && range="${prev}..${current}"

subjects="$(git log --no-merges --format='%s (%h)' "$range" -- "$path")"

section() { # title, regex of conventional types
  local lines
  lines="$(printf '%s\n' "$subjects" | grep -E "^($2)(\([^)]*\))?!?: " | sed -E 's/^[a-z]+(\([^)]*\))?!?: /- /' || true)"
  [ -n "$lines" ] && printf '### %s\n%s\n\n' "$1" "$lines"
  return 0
}

echo "## What's changed"
echo
if [ -z "$subjects" ]; then
  echo "No changes recorded for this component."
  echo
else
  section "Features" "feat"
  section "Fixes" "fix"
  section "Other" "perf|refactor|docs|chore|build|ci|test|style"
  other="$(printf '%s\n' "$subjects" | grep -vE "^(feat|fix|perf|refactor|docs|chore|build|ci|test|style)(\([^)]*\))?!?: " | sed 's/^/- /' || true)"
  [ -n "$other" ] && printf '### Unclassified\n%s\n\n' "$other"
fi
if [ -n "$prev" ]; then
  echo "Changes since \`$prev\`."
else
  echo "First release of this component."
fi
exit 0
