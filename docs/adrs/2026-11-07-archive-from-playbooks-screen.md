# Archive a run from the Playbooks screen

Status: Accepted

## Context

A finished run could only be archived from the workspace panel, in its tab's chevron menu. The
Playbooks screen lists every workspace's runs, so clearing finished ones meant opening each
workspace's panel. **Show done** hides done runs already opened, but failed and canceled runs,
and done runs not opened yet, stay on the screen until archived.

## Decision

- A run row on the Playbooks screen gets an Archive icon button after its manager and workspace
  buttons, when the run is finished and its after-tasks are done (the same rule as the panel's
  "Archive run").
- It calls the existing `runs.archive` RPC and refreshes the screen. Nothing else changes:
  archiving still only hides the run; its agents and saved state are kept.
- There is no confirmation, as in the panel. `restart_run` (with `list_runs archived: true`)
  still reopens an archived run.

## Consequences

- The buttons column of a run row is wider (90 instead of 64) to fit three buttons.
- No new RPC or run state.
