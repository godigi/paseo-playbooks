# Recover a run: take it over with restart_run, and survive a coordinator's archiving

Status: Accepted

## Context

ANY-2813 needed three runs. A canceled run could not be resumed by the agent that wanted
to manage it. `restart_run` (`2026-11-04-agent-restart-and-manager-takeover.md`) keeps the
old manager or creates a new one; the caller can never become the manager itself.

Another run failed with "manager lost (archived)" in the middle of babysit, because a human
archived the Coordinator. Paseo core archives an agent's children with it
(`AgentManager.cascadeArchiveChildren`: every agent whose `paseo.parent-agent-id` label points
at it, unless it is in another workspace or has an open tab). The Coordinator had created the
manager with `create_agent`, and the manager had created the step agents with a parent, so
the whole run went with it. Plugins get `agent.archived` only after the fact. There is no
`before` hook to stop an archive or ask for confirmation.

The plugin could detach the manager from its parent (`agent.detach()`), but Paseo then drops
the parent's finish notifications for that agent (`requireParentOwnership`). A Coordinator
waiting for its manager would never hear back. So the plugin does not detach.

## Decision

- `restart_run` takes `takeOver` (default false). With `true`, the caller becomes the run's
  manager, and no other manager is woken or created. The caller must be an agent of the
  run's workspace and must have the manager tools (its workspace has playbooks, or it already
  managed a run). The usual restart rules apply.
- When the manager of an active run is archived and its parent agent is archived too (Paseo's
  cascade), the run does not fail. A new Playbook Manager is created in the run's workspace
  and takes it over (`manager_replaced` in the history), with the takeover prompt. Completed
  steps keep their outputs. Steps whose agents went with the cascade end as lost; the new
  manager starts them again with `complete_step` "failure" (a lost attempt does not count as
  a retry). The run is not archived.
- A manager archived on its own (no parent, or a parent that still exists) still fails its
  active run with "manager lost (archived)", as before: that is a decision about the run.
- `list_runs` shows each run's `failure`, so an agent can tell a "manager lost" run from one
  that failed on its own.

## Consequences

- A run that failed with "manager lost" or was canceled partway can be resumed by another
  manager from the step it reached, without repeating completed steps.
- Archiving a coordinator no longer ends the runs its managers drive. Their in-flight steps
  restart from scratch in the same worktree; their work so far stays in the worktree.
- A run's `managerAgentId` can change without any restart.
- Asking for confirmation before archiving an agent that drives a running run needs a Paseo
  core change (a `before` hook on archive, or a confirmation in the app). The plugin cannot
  do it.
