# Conditional steps: `when` on the run's inputs

Status: Accepted

Decides the `when:` that `2026-11-05-sub-playbook-outcomes.md` left open, for inputs only.

## Specification changes

| Change    | Where       | Kind    | Summary                                                    |
| --------- | ----------- | ------- | ---------------------------------------------------------- |
| `when`    | step        | new     | Runs the step only for some input values, else skips it    |
| `skipped` | step status | changed | Also a step whose `when` did not match (before: an `end`)  |

## Context

A playbook cannot run a step for some values of an input only: `goto` only points back, and
`when:` was left open. Stages that differ by one step (a human go before the last one) need a
playbook each.

## Decision

A step may declare `when:`, a map of the run's inputs to values: `when: { env: prd }`, or a
list of values, `when: { env: [stg, prd] }`. The step runs only when every listed input has
one of its values; otherwise it is **skipped** as soon as it would be ready, with the
`skipped` status an `end` inside a block already gives (`2026-11-03-end-inside-block.md`).

```yaml
steps:
  - id: go
    when: { env: prd }
    gate: { question: "Apply these jobs to {{ inputs.env }}?" }
  - id: apply
    needs: [go]
    role: { name: applier }
```

- There is no expression language: only equality on inputs known when the run (or block)
  starts: the playbook's inputs, or a sub-playbook's (read through the parent's wiring). In a
  singleton playbook, only the run's inputs (its key) may be listed, not each job's. Each
  input must exist, and each value must fit its type.
- A skipped step counts as done for the steps that need it, so `needs: [go]` after a skipped
  `go` gate is ready at once. Its outputs are unset: a later step may not read an output of a
  step with `when:` unless it has the same `when:` (validation).
- A `when` on a playbook step applies to every step of the block. After-tasks have none.
- The run's history records the skip and why, and the panel draws the step as skipped.

## Consequences

- Stages that differ by a step share one playbook; conditions on step outputs stay out, and
  outcome routing still covers early exits.
- Additive: steps without `when` behave as before.
