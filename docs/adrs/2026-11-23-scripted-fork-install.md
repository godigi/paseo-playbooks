# Scripted installs of the godigi fork

## Status

Accepted. Supersedes the 2026-11-18 rule "merge only, no plugin swap" (the parked scripted fork deploy, #108), which lived in the fork's host-local `.paseo/delivery.json` and had no ADR of its own.

## Context

Decided by the owner on 2026-11-23 in the paseo-plugins session 445caad0. The fork's patches are all upstream now (main is synced to v0.173.1), but future fork fixes (first: `read_agent_conversation` returning its text to Claude callers) must be built, reviewed, merged and installed like any other repo. A hand install after each merge was the bottleneck, and the installed plugin still pointed at upstream.

## Decision

`scripts/fork-install.sh <sha>` installs the plugin from an exact commit on godigi main, and `.paseo/delivery.json` names it as the deploy step (with `--owner-gate`, since a live plugin swap is high-risk). The script:

- refuses while any Playbooks run is active (running, waiting_gate, or a running step), failing closed on unreadable state, because `plugin remove` strips managers and step agents of their tools;
- records the installed commit and remote first, backs up `sources.json`, the plugin directory and `plugin-settings`, and honors `PASEO_HOME`;
- polls up to 90 s for `running`, then checks the commit, version and remote;
- after `remove`, any failure reinstalls the previously installed commit automatically (recorded remote first, then the fork), verifies it runs, and exits non-zero either way.

`--dry-run` runs every check and prints the commands without `remove` or `install`.

## Consequences

- Fork fixes ship through the normal delivery pipeline; the install is atomic enough that a failed swap restores the old plugin.
- Installs wait for idle: a busy host defers the deploy instead of interrupting runs.
- Plugin data is untouched (`plugin-data/paseo-playbooks` is a symlink to the existing data), but a reinstall restarts the plugin.
