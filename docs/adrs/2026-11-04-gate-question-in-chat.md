# Gates are also asked in chat

Status: Accepted

Supersedes decision 39 (gate notice) of `2026-11-02-design.md`.

## Context

Decision 39 relied on Paseo's own attention when the manager ends its turn after
`request_gate`. That is the "finished" state (a blue dot), and Paseo clears it at once if
the human is looking at the workspace. A gate then looks just like any finished agent.

Paseo shows a workspace as needing input (the yellow dot, with a push) only for a pending
permission or question of an agent. The plugin API (`@getpaseo/plugin` 0.14) cannot raise
that state itself. An agent's question tool (`AskUserQuestion` in Claude Code,
`request_user_input` in Codex, the equivalents of other providers) can.

## Decision

- When a gate opens (`request_gate`, a loop limit or an `ask` gate), the tool result and
  the manager protocol tell the manager to ask the human with its question tool: the
  gate summary as the question, one option per gate choice. The manager records the answer
  with `resume` (`decidedVia: chat`). A manager without such a tool tells the human and
  ends its turn, as before.
- The panel stays a way to decide. When a gate is decided in the panel, or the run is
  canceled from it, the plugin answers every pending question of the manager with a deny
  that names the decision. The manager's turn ends and the usual wake-up is delivered.
- The run state, the gate format and the tools' inputs do not change.

## Consequences

- An open gate puts its workspace in "needs input" in the sidebar and sends a push.
- The manager stays in a turn while it waits for the answer. Wake-ups for that run are
  queued until the turn ends, as for any busy manager.
- The plugin dismisses any pending question of the manager, not only the gate's. A
  manager only asks questions while it waits for a gate, so this is safe in practice.
- If Paseo adds a plugin API to raise attention, a new ADR can replace this with it.
