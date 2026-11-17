#!/usr/bin/env bash
# Demo "CI": runs the demo-shop test suite RUNS_PER_COMMIT times on each of its git commits, exactly like CI
# re-runs, and uploads every real JUnit report to FlakeLens. Nothing is simulated except the CI server itself.
# Usage: FLAKELENS_URL=... FLAKELENS_TOKEN=... demo_ci.sh [project] [runs-per-commit]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
project=${1:-demo-shop}; per=${2:-4}
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
repo="$work/repo"; "$here/make_demo_history.sh" "$repo" >/dev/null
n=0
for c in $(git -C "$repo" rev-list --reverse HEAD); do
  git -C "$repo" worktree add -q --detach "$work/$c" "$c"
  for i in $(seq 1 "$per"); do
    n=$((n+1)); out="$work/run-$n.xml"
    (cd "$work/$c" && node --test --test-reporter=junit --test-reporter-destination="$out" 'test/*.test.js' >/dev/null 2>&1) || true
    echo "run $n commit ${c:0:8}: $(grep -c '<failure' "$out") failing"
    "$here/upload-junit.sh" "$out" "$project" "$c" "ci-$n" main
  done
  git -C "$repo" worktree remove --force "$work/$c"
done
