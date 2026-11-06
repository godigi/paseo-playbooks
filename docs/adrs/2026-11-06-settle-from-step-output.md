# Train steps settle their jobs from an output

Status: Accepted

## Context

A train's manager settles each job with `settle_job` (`2026-11-06-singleton-pipelines.md`):
outputs that later stations read, or an outcome that ends the job now. In the first live
runs the steps reported what to settle (a `job_results` output), but the manager completed
the steps without calling `settle_job`. A job with nothing to deploy then rode every station,
reached the end with no outputs, failed, and was handed off again. Settling depended on the
manager remembering a rule written in a description.

## Decision

- A role or script step may declare `settle: { output: <name> }`, naming one of its string
  outputs. That output holds YAML: per job id, `{ outputs: {...}, outcome?, reason? }` (empty,
  `none` or `{}` settles nothing; comments are ignored).
- When such a step completes (an outcome whose transition is complete, end or goto) on a
  train of a singleton pipeline, the plugin applies every entry as `settle_job` would, before
  the transition can end the train: outputs are set, a job with an outcome ends and its
  hand-off is told. `complete_step` first tries the entries on a copy of the pipeline and
  refuses the completion, saying which entry is wrong, if one does not apply. Completions the
  plugin makes itself (a script step, an ask choice with an outcome) apply what they can and
  tell the manager what failed.
- Outside a train (the playbook run on its own, or used as a sub-playbook elsewhere) `settle`
  has no effect.
- A block option in block form (`2026-11-06-group-step-kind-fields.md`): it configures a
  feature of the step, so it is a block, not a flat field.
- A hand-off step requires the singleton's outputs only with its first outcome. A job ended
  early (`no_deploy`, `stopped`, `ejected`) brings the outputs it has; before this, its result
  was refused for missing outputs and the hand-off failed.

## Consequences

- Settling no longer depends on the manager: a step that knows the jobs' results returns them,
  and the plugin applies them. `settle_job` stays for the manager's own corrections.
- A wrong entry stops the completion with a message the manager can act on, instead of a job
  silently going on.
- Minor version: a new optional field; nothing existing changes.
