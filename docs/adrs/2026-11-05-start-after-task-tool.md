# Agents start a manual after-task when the human asks

Status: Accepted

## Context

`2026-11-03-after-tasks.md` made `manual` after-tasks (a retro, for example) a button on the
finished run: only the panel could start them. A human who asked their manager in chat to
run the retro got "click Start in the Playbooks panel" back, although the manager had the
notes to hand it and the human had already decided.

## Decision

- A new tool, `start_after_task` (`runId`, `taskId`), starts a pending `manual` after-task of
  a finished run, with the same checks as the panel button (run ended, task manual, runs
  once, no other active run in the workspace, manager still exists).
- Every agent except step agents gets it, like `cancel_run` and `restart_run`. Its
  description tells agents to call it only when the human asks.
- The run's manager runs the task. If the caller is the manager, it reads the ready steps in
  the tool result and is not woken; otherwise the manager is woken with who started it.
- `list_runs` shows each run's after-tasks with their trigger and status.

## Consequences

- Asking in chat is enough to start a retro; the panel button stays.
- The agent tools' contract grows by one tool; the playbook format does not change.
