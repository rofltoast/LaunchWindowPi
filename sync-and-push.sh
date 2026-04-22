#!/usr/bin/env bash
# sync-and-push.sh
#
# Usage: ~/LaunchWindowPi/sync-and-push.sh <source-tarball> "commit message"
#
# Takes a tarball of the source tree (built in the Claude sandbox),
# replaces the tracked files in ~/LaunchWindowPi with the tarball
# contents, then commits + pushes to origin/main.
set -euo pipefail

TARBALL="${1:?usage: sync-and-push.sh <tarball> <msg>}"
MSG="${2:?commit message required}"
REPO="${HOME}/LaunchWindowPi"

cd "$REPO"
echo "[sync] extracting $TARBALL"
# Extract over the top; .gitignore'd paths stay put.
tar xzf "$TARBALL" -C "$REPO"

echo "[sync] git status"
git add -A
if git diff --cached --quiet; then
  echo "[sync] no changes — nothing to commit"
  exit 0
fi
git commit -m "$MSG"
git push
echo "[sync] pushed"
