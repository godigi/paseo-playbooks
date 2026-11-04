# Agents restart runs, and a new manager takes over when the old one is gone

Status: Accepted (supersedes `2026-11-04-restart-from-step.md`)

## Context

`2026-11-04-restart-from-step.md` made restart a panel-only action that kept the run's
manager, and refused it on archived runs or when the manager no longer existed. Archiving a
manager also archives its runs. So once a human archived the manager of a canceled run, the run
could not be resumed at all. An agent asked to resume it had no tool for that, and no way to
start a new run mid-way.

## Decision

- A new `restart_run` tool (`runId`, `stepId`, optional `note`) goes to every agent except step
  agents, like `cancel_run`. It does what the panel's "Restart run from here" does, with the
  same rules (main-graph step whose needs are done, no after-task running, no other active run
  in the workspace, concurrency slots free). The note becomes the step's feedback.
- An archived run can be restarted. The restart unarchives it.
- When the run's manager no longer exists or is archived, the restart (from the panel or the
  tool) creates a new Playbook Manager in the run's workspace, with the playbook's manager
  config. It becomes the run's manager and gets the takeover prompt with the ready steps.
  Otherwise the existing manager is woken, as before.
- `list_runs` takes `archived: true` to include archived runs. Each listed run shows
  `archived` and `restartableFrom`, the steps `restart_run` accepts.
- A new run still cannot start mid-way. Restarting the existing run keeps the earlier steps'
  real outputs.

## Consequences

- An agent can resume a stopped run from any chat, even after its manager was archived.
- A run's `managerAgentId` can change during its life. Code reads it from the run each time.
- Restart is no longer human-only. Any non-step agent can reopen any finished run on the
  daemon.
