# Ask gates with several choices

Status: Accepted

## Context

An `ask` gate had one button, `answered`, and one `goto`. A human who wanted a different route,
such as sending a blocked QA step straight back to `fix` with a code change to make, had to
answer with instructions for the step to report another outcome, which cost an extra attempt.

## Decision

- An `ask` transition may declare `choices`: a map of choice id to `{ goto, max_loops, label,
  color, comment }`. `goto` and `max_loops` default to the ask's, `comment` to `required`.
- Each choice goes to its own target, which gets `The human answered "<id>": <comment>` as
  feedback. The validator checks every choice's target like a `goto`.
- An ask gate records the step outcome that opened it (`outcome` on the gate) to find its
  choices. Gates opened before fall back to matching their target.
- Without `choices` nothing changes: one `answered` button, the answer alone as feedback.

## Consequences

- Playbooks can route a human's answer to any earlier step without an extra attempt.
- The format change is additive: existing playbooks and runs keep working.
