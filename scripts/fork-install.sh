#!/usr/bin/env bash
# Reinstall the paseo-playbooks plugin from an exact commit of the godigi fork (ADR 2026-11-23-scripted-fork-install).
# Usage: scripts/fork-install.sh [--dry-run] <40-char sha on godigi/paseo-playbooks main>
#   --dry-run: runs every check and prints the commands; never calls `paseo plugin remove` or `install`.
# Honors PASEO_HOME (default ~/.paseo). If anything fails after `remove`, the previously installed commit is
# reinstalled automatically, checked to be running, and the script exits non-zero either way.
set -euo pipefail
DRY=0; if [ "${1:-}" = "--dry-run" ]; then DRY=1; shift; fi
SHA="${1:?usage: fork-install.sh [--dry-run] <full sha>}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "need a full 40-char sha" >&2; exit 2; }
ID=paseo-playbooks; FORK_REPO=godigi/paseo-playbooks; FORK_URL="${FORK_URL:-https://github.com/$FORK_REPO.git}"   # FORK_URL: tests point it at a local repo
PH="${PASEO_HOME:-$HOME/.paseo}"; PP=(paseo plugin); H=(--home "$PH")
POLL_SECS="${POLL_SECS:-90}"
say() { echo "[fork-install] $*"; }
run() { if [ "$DRY" = 1 ]; then say "DRY-RUN would run: $*"; else "$@"; fi; }

# poll `plugin ls --json` until the plugin is enabled and running (or the timeout passes)
wait_running() {
  local t=0
  while [ "$t" -lt "$POLL_SECS" ]; do
    if "${PP[@]}" ls "$ID" "${H[@]}" --json 2>/dev/null | python3 -c 'import json,sys;d=json.load(sys.stdin);d=d[0] if isinstance(d,list) else d;sys.exit(0 if d.get("enabled") and d.get("status")=="running" else 1)'; then return 0; fi
    sleep 3; t=$((t+3))
  done
  return 1
}

# ---- automatic rollback once `remove` has run; also cleans $TMP. Set before any early exit so nothing leaks.
TMP="$(mktemp -d)"; BK="(no backup yet)"; ROLLBACK_REPOS=()
REMOVED=0; DONE=0
rollback() {
  local rc=$1; rm -rf "$TMP"
  [ "$REMOVED" = 1 ] && [ "$DONE" = 0 ] || exit "$rc"
  say "FAILED (exit $rc) after remove: reinstalling $PREV_SHA"
  local ok=0 repo
  for repo in "${ROLLBACK_REPOS[@]}"; do
    "${PP[@]}" remove "$ID" "${H[@]}" >/dev/null 2>&1 || true   # clear any half-installed copy
    if "${PP[@]}" install "git:$repo" --id "$ID" --ref "$PREV_SHA" "${H[@]}" && wait_running; then ok=1; break; fi
  done
  if [ "$ok" = 1 ]; then say "ROLLBACK OK: $PREV_SHA is running again"; else say "ROLLBACK FAILED. Reinstall by hand: ${PP[*]} install git:$FORK_REPO --id $ID --ref $PREV_SHA ${H[*]}; backup in $BK"; fi
  exit "$([ "$rc" -ne 0 ] && echo "$rc" || echo 1)"
}
trap 'rollback $?' EXIT   # one EXIT trap covers set -e failures too

# ---- 1. what is installed now (recorded BEFORE anything changes; the rollback target)
CUR_JSON="$("${PP[@]}" ls "$ID" "${H[@]}" --json)"
read -r PREV_SHA PREV_REMOTE < <(printf '%s' "$CUR_JSON" | python3 -c 'import json,sys;d=json.load(sys.stdin);d=d[0] if isinstance(d,list) else d;print(d["commit"],d["remote"])')
[[ "$PREV_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "cannot read the installed commit" >&2; exit 2; }
PREV_REPO="$(printf '%s' "$PREV_REMOTE" | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##')"
say "installed now: $PREV_SHA from $PREV_REMOTE"

# ---- 2. idle precondition: `remove` strips managers and step agents of their tools mid-run. Fails closed.
RUNS="$PH/plugin-data/$ID/runs"
[ -d "$RUNS" ] || { echo "runs dir $RUNS not found; refusing (fail closed)" >&2; exit 8; }
IDLE_FAIL=0
idle_check() { python3 - "$RUNS" <<'PY'
import json, glob, sys
active = []
def walk(o):
    if isinstance(o, dict):
        if o.get("status") == "running": return True
        return any(walk(v) for v in o.values())
    if isinstance(o, list): return any(walk(v) for v in o)
    return False
files = glob.glob(sys.argv[1] + "/*.json")
if not files: sys.exit("no run files found")
for f in files:
    d = json.load(open(f))  # unreadable -> traceback -> non-zero
    # fail closed: only the terminal statuses count as idle; anything else (or a missing status) is active
    if d.get("status") not in ("completed", "failed", "canceled") or walk(d.get("steps")) or walk(d.get("after")):
        active.append((f.rsplit("/", 1)[-1], d.get("status")))
if active:
    print("active runs:", active, file=sys.stderr); sys.exit(1)
print(f"[fork-install] idle: {len(files)} run files, none active")
PY
}
idle_check || {
  echo "refusing: a Playbooks run is active or its state is unreadable (fail closed)" >&2
  if [ "$DRY" = 1 ]; then say "DRY-RUN: this check would REFUSE the real run; continuing to show the other checks"; IDLE_FAIL=1; else exit 8; fi
}

# ---- 3. the target and the rollback commit must both be fetchable from the fork
git clone -q --filter=blob:none --no-checkout "$FORK_URL" "$TMP/r"
git -C "$TMP/r" merge-base --is-ancestor "$SHA" origin/main || { echo "$SHA is not on $FORK_REPO main" >&2; exit 4; }
WANT="$(git -C "$TMP/r" show "$SHA:package.json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["version"])')"
# rollback sources, in order: the recorded remote, then the fork (the current commit may only exist there)
ROLLBACK_REPOS=("$PREV_REPO"); [ "$PREV_REPO" = "$FORK_REPO" ] || ROLLBACK_REPOS+=("$FORK_REPO")
git -C "$TMP/r" cat-file -e "$PREV_SHA^{commit}" 2>/dev/null || git -C "$TMP/r" fetch -q origin "$PREV_SHA" 2>/dev/null || { echo "rollback commit $PREV_SHA is not reachable on $FORK_REPO; refusing" >&2; exit 9; }
say "target: $WANT at $SHA; rollback: $PREV_SHA via ${ROLLBACK_REPOS[*]}"

# ---- 4. backups (the state to restore by hand if the automatic rollback also fails)
BK="$PH/backups/playbooks-$(date +%Y%m%d-%H%M%S)"
if [ "$DRY" = 1 ]; then say "DRY-RUN would back up to $BK: plugins/sources.json, plugins/$ID, plugin-settings/$ID (if present)"; else
  mkdir -p "$BK"; cp -a "$PH/plugins/sources.json" "$BK/"; cp -a "$PH/plugins/$ID" "$BK/plugin-dir"
  [ -e "$PH/plugin-settings/$ID" ] && cp -a "$PH/plugin-settings/$ID" "$BK/plugin-settings"
  say "backup: $BK"
fi

# ---- 6. swap
[ "$DRY" = 1 ] || REMOVED=1   # before remove: a failure or kill during remove must still roll back
run "${PP[@]}" remove "$ID" "${H[@]}"
run "${PP[@]}" install "git:$FORK_REPO" --id "$ID" --ref "$SHA" "${H[@]}"

# ---- 7. verify (polls for running)
if [ "$DRY" = 1 ]; then say "DRY-RUN would verify: running (poll ${POLL_SECS}s), checkout HEAD = $SHA, version = $WANT, sources.json remote = $FORK_REPO"; DONE=1; if [ "$IDLE_FAIL" = 1 ]; then say "dry run complete: the idle check FAILED (runs are active); every other check passed"; exit 8; fi; say "dry run complete: all checks passed"; exit 0; fi
wait_running || { echo "plugin not running after ${POLL_SECS}s" >&2; exit 5; }
CO="$(ls -d "$PH"/plugins/$ID/*/checkout | head -1)"
[ "$(git -C "$CO" rev-parse HEAD)" = "$SHA" ] || { echo "checkout is not at $SHA" >&2; exit 6; }
[ "$(python3 -c "import json;print(json.load(open('$CO/package.json'))['version'])")" = "$WANT" ] || { echo "version mismatch" >&2; exit 6; }
grep -q "$FORK_REPO" "$PH/plugins/sources.json" || { echo "sources.json still points at upstream" >&2; exit 7; }
DONE=1
say "installed $WANT at $SHA. Next: call list_runs from a NEW agent session to prove the tools load."
say "Manual rollback: ${PP[*]} remove $ID ${H[*]} && ${PP[*]} install git:$FORK_REPO --id $ID --ref $PREV_SHA ${H[*]}"
