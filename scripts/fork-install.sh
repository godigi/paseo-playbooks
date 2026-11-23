#!/usr/bin/env bash
# PROPOSAL (not run): reinstall the paseo-playbooks plugin from an exact commit of the godigi fork.
# Usage: scripts/fork-install.sh <40-char sha on godigi/paseo-playbooks main>
# Needs owner approval before first use (live plugin swap). Backs up first; restores on a failed verify.
set -euo pipefail
SHA="${1:?usage: fork-install.sh <full sha>}"; [[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "need a full 40-char sha" >&2; exit 2; }
REMOTE="https://github.com/godigi/paseo-playbooks.git"; ID=paseo-playbooks
BK="$HOME/.paseo/backups/playbooks-$(date +%Y%m%d-%H%M%S)"
# 1. the commit must be on the fork's main (not just any branch)
git ls-remote "$REMOTE" refs/heads/main | grep -q . || { echo "cannot reach $REMOTE" >&2; exit 3; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git clone -q --filter=blob:none --no-checkout "$REMOTE" "$TMP/r"
git -C "$TMP/r" merge-base --is-ancestor "$SHA" origin/main || { echo "$SHA is not on godigi main" >&2; exit 4; }
WANT="$(git -C "$TMP/r" show "$SHA:package.json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["version"])')"
# 2. back up sources.json and the installed checkout (plugin-data is untouched by install/remove)
mkdir -p "$BK"; cp -a ~/.paseo/plugins/sources.json "$BK/"; cp -a ~/.paseo/plugins/"$ID" "$BK/plugin-dir"
echo "backup: $BK"
# 3. swap the source to the fork at the exact commit
paseo plugin remove "$ID"
paseo plugin install "git:godigi/paseo-playbooks" --id "$ID" --ref "$SHA"
# 4. verify: running, right commit, right version, remote is the fork
paseo plugin ls "$ID" --json | python3 -c 'import json,sys;d=json.load(sys.stdin);d=d[0] if isinstance(d,list) else d;assert d.get("enabled") and d.get("status")=="running",d'
CO="$(ls -d ~/.paseo/plugins/$ID/*/checkout | head -1)"
[ "$(git -C "$CO" rev-parse HEAD)" = "$SHA" ] || { echo "checkout is not at $SHA" >&2; exit 5; }
[ "$(python3 -c "import json;print(json.load(open('$CO/package.json'))['version'])")" = "$WANT" ] || exit 6
grep -q godigi/paseo-playbooks ~/.paseo/plugins/sources.json || { echo "sources.json still points at upstream" >&2; exit 7; }
echo "installed $WANT at $SHA. Next: call a playbooks tool (list_runs) from a NEW agent session to prove the tools load; roll back with: paseo plugin remove $ID && cp -a $BK/sources.json ~/.paseo/plugins/ && restore $BK/plugin-dir"
