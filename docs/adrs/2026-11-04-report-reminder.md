# Remind a step to report before waking the manager

Status: Accepted

## Context

Paseo binds the tools a plugin adds in `agent.session_open` to the plugin instance that was
loaded when the session opened. When the plugin reloads (an update, a restart of its
process), live sessions keep running but their plugin tools are filtered out: calls fail with
"not found", even after the model reloads the tool schema. Paseo reopens such a stale session
only when the agent next receives a prompt and has no turn in flight.

A step agent that waits a long time inside one turn (polling a PR with background tasks, for
example) outlives a plugin reload and cannot call `report_step_result` at the end
(ANY-2839). The plugin cannot reattach tools to a running session; that needs a Paseo change.

## Decision

- When a step agent's turn completes without a report, the plugin sends it one reminder in the
  same conversation before waking the manager. The reminder is a new prompt, so Paseo reopens
  the stale session and `report_step_result` is available again.
- Each attempt gets at most one reminder, recorded as `reminded` on the attempt (defaults to
  `false`, so older run files still load). No reminder for failed, canceled, lost or timed-out
  turns, or while the run is paused.
- If the step still ends without a report, the manager is woken as before, told that the
  reminder did not help, and pointed to the fallback: check the outputs in the step's
  conversation and call `complete_step` with them.
- The step prompt tells agents that, if the tool is missing, they write their outcome, summary
  and outputs in their last message and end their turn.

## Consequences

- Long-waiting steps report after a plugin reload without the manager's help.
- A step that ends its turn on purpose while waiting (for a background poll, say) gets one
  extra message, and answers it before the manager hears about it.
- The root cause stays in Paseo: plugin tools of a live session should follow the plugin
  instance that replaced the one they were attached with.
