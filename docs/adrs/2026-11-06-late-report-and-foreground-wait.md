# Wake the manager on a late report; step agents wait in the foreground

Status: Accepted

## Context

After the report reminder (`2026-11-04-report-reminder.md`), a step agent that is still
waiting (for CI, say) was told to "say what and end your turn". Agents then ended the turn
waiting on a Monitor, a background command or a timer. When that woke them and they called
`report_step_result`, the report was accepted, but the step was already `reported` (its turn
had ended twice), so the turn end that followed was ignored and the manager was never woken
(ANY-2951). And nothing guarantees such an agent is woken at all (ANY-2952).

## Decision

- A report accepted for an attempt whose turn already ended (step `reported`, not reopened)
  wakes the manager right away with the same line a reported turn end sends, plus "It reported
  after its turn had ended." The readonly check runs again first. The turn end that follows
  stays ignored.
- The step system prompt tells agents to wait inside their turn with a bounded foreground poll,
  and never to end the turn waiting on a Monitor, a background command or a timer.
- The report reminder tells a still-waiting agent to keep waiting in the same turn with a
  foreground poll, then call `report_step_result`, instead of saying what and ending its turn.

## Consequences

- A late report reaches the manager within seconds instead of being lost.
- No change to the run file or the tools' inputs: older runs and playbooks work as before.
- Long waits are better done by a script step; a foreground poll keeps the agent's turn
  (and the silence reminder) going until it returns.
