# Ask choices that end the step

Status: Accepted

## Context

An `ask` choice could only `goto` a step (`2026-11-05-ask-choices.md`). A human who accepts
what the step already found, such as criteria an environment QA could not verify, had to send
the step back to its agent, which ran the whole QA again only to report the same result with
another outcome. What the human accepted was lost too: nothing carried it to later steps.

## Decision

- An ask choice may declare `outcome: <outcome of the step>` instead of `goto`. Choosing it
  ends the asking step with that outcome, as if the step had reported it, without a new
  attempt: the outcome's `on` entry applies (`complete`, `end`, `fail` or `goto`). The
  validator refuses an unknown outcome, one whose `on` is an `ask`, and `goto` or `max_loops`
  on the same choice.
- With `outcome`, `outputs` sets the step's outputs: templates over `gate.comment`,
  `gate.choice`, `report.summary`, `report.outputs.<output>` and `inputs.<input>`, merged over
  the last report's outputs and checked like a report when the outcome completes, ends or
  loops. A missing output refuses the decision and leaves the gate open. Only declared outputs
  may be set.
- A report with an `ask` outcome still needs no outputs, but keeps the declared ones it gives
  (with the right type) so a choice can carry them on.
- The panel shows where such a choice leads like a gate choice (→ next step, → End, → Fail
  run); the graph draws no loop edge for it.

## Consequences

- A human can accept a step's result from its ask gate in one click, and what they accepted
  (`{{ gate.comment }}`) becomes an output later steps can read.
- Additive: choices without `outcome` and existing runs behave as before.
