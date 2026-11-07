# Who decides a gate: a human, the manager, or a role

Status: Accepted

## Context

Every gate is a human gate: a gate step, an `ask` transition, and the loop-limit gate a
`max_loops` opens. The manager opens it, asks the human in chat, and calls `resume` with
their answer (`decidedVia: "chat"`), or the human decides in the panel (`"panel"`). Nothing
stops the manager from calling `resume` with a decision of its own; only the protocol forbids
it, and the record cannot tell a manager's decision from a human's.

Some checkpoints do not need a human every time: one more review loop when the findings are
only nits, an `ask` whose answer is in the run. A boolean "the manager may decide" was
considered. It was rejected for a "who" field: the manager is the agent pushing the run
forward, so it is a poor judge of whether to skip a human, and the rules for when a gate may
be cleared belong in reviewable instructions, not in the manager's judgement. A role gives
both: a separate readonly agent whose `instructions.md` says when it decides and when it
leaves the gate to a human.

## Decision

- Every kind of gate takes a `decider` block, `{ by: human | manager | role, role: <id> }`;
  absent means `{ by: human }`, as today:
  - a gate step: `gate: { question, choices, decider: { by: role, role: gatekeeper } }`;
  - an `ask` transition: `on: { x: { ask: "…", goto, choices, decider: { by: manager } } }`;
  - the loop-limit gate of a `goto`: `on: { x: { goto, max_loops, decider: { … } } }`.
    `decider` on a `goto` without `max_loops` is an error (it opens no gate). The loop-limit
    gate of an `ask` choice's `max_loops` follows the `ask`'s `decider`.
  `role` is required with `by: role` and refused otherwise. The role must be `readonly`.
- The opened gate records its decider. A human can always decide first in the panel, and the
  first decision wins. A manager or role that does not decide escalates: the gate goes to a
  human exactly as a human gate does, with the decider's reason added to its details.
- `by: manager`: the manager decides alone with `resume` and `byManager: true`, which needs
  a `comment` with its reason and is recorded as `decidedVia: "manager"`. Or it escalates by
  asking a human, as for a human gate. `byManager` on another gate is refused.
- `by: role`: when the gate opens (a gate step once the manager calls `request_gate`), the
  plugin starts an agent with the role, readonly as any readonly step. Its prompt holds the
  gate's text, its choices, and the summaries and outputs of the run's completed steps. It
  calls a new step-agent tool, `report_gate_decision { decision, comment }`, where `decision`
  is one of the gate's choices or `escalate`, and `comment` (required) is its reason. A
  choice is recorded as `decidedVia: "role"` with `decidedBy` the role id. `escalate`, an
  agent that ends its turn without a decision after one reminder, an agent that fails to
  start, is archived, or is lost in a daemon restart all escalate. There is no decider
  timeout: the agent's turn always ends. The manager is told the gate is with the role, ends
  its turn, and is woken with the decision or the escalation. The agent's settings merge as
  a step's (defaults, playbook, role), and it is archived once its turn ends (unless the
  gate's step sets `archive_agents: false`), or at once when someone else decides first.
- A gate a role still holds does not count as waiting for a human: the panel's "needs you"
  counts and a train's gate notices leave it out until the role escalates. A manager's gate
  counts, since the manager leaves it to a human just by asking.
- On a human gate nothing changes: the protocol keeps telling the manager to ask a human and
  relay the answer. The plugin cannot tell a relayed answer from the manager's own, so this
  stays trust-based.
- Train gates relayed to the run that handed off a job (`2026-11-06-train-gate-notices.md`)
  stay the train's: the decider applies to that train, never to the relaying manager.
- Run state: a gate gains `decider` (default `{ by: human }`) and `decidedVia` gains
  `manager` and `role`; older run files still load. The agent tools gain `byManager` on
  `resume` and `report_gate_decision` for decider agents.

## Consequences

- Playbook authors choose, gate by gate, who may clear it, and every decision records who
  took it and why.
- A role decider costs an agent per opened gate and adds its latency; a manager decider costs
  neither but judges its own run.
- A manager or role can approve what a human would have refused; the author opts into that
  per gate, and a human can still decide first or be escalated to.
- The loader, types, engine, runtime, tools, protocol, panel gate line, skill, README,
  website reference and examples change; tests cover each gate kind and decider.
