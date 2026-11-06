# Hand-off steps: a run hands a job to a singleton playbook and waits for its result

Status: Accepted

## Specification changes

| Change                | Where        | Kind | Summary                                                            |
| --------------------- | ------------ | ---- | ------------------------------------------------------------------ |
| `handoff: <playbook>` | step         | new  | Fifth step kind: hands a job to a singleton and waits              |
| `settle_job`          | manager tool | new  | Settles one job with an outcome and outputs                        |

## Context

A run cannot hand work to another run and wait for its result: a sub-playbook step runs its
playbook inside the same run, for that run alone. Singleton playbooks
(`2026-11-06-singleton-playbooks.md`) take work from other runs; this decision is how a run
gives it and gets the result back.

## Decision

A fifth step kind, `handoff: { name: <singleton playbook> }`, with `inputs`, `on`, `timeout` and
`retries`:

```yaml
- id: apply_dev
  needs: [approve]
  handoff: { name: apply }
  inputs: { env: dev, pr_urls: ~ }
  on:
    rejected: { goto: fix, max_loops: 2 }
```

- `handoff` is a block, as every step kind (`2026-11-06-group-step-kind-fields.md`):
  `handoff: apply` is refused with the form to write, `handoff: { name: apply }`.
- The target must declare `singleton:` and be in the same playbooks folder (so the same
  Paseo project). The step's contract is the target's own `inputs`, `outputs` and
  `outcomes`, plus `failure`, as for a sub-playbook step. Every outcome but the first (and
  `failure`) needs an `on` entry: `complete`, `end`, `fail` or `goto`, not `ask`. `prompt`,
  `outputs`, `outcomes`, `agent`, `silence` and `archive_agents` do not apply.
- Like a script step, the plugin starts it and completes it: the manager never calls
  `start_step` or `complete_step` for it, and is woken with the result.
- Starting the step creates a **job** with the step's rendered inputs, checked against the
  target read from the handing-off workspace, kept in run state, and adds it to the boarding
  run for its key. The step waits, like a gate, and shows where its job is.
- **Settling.** The running run's manager settles each job with a new tool,
  `settle_job(runId, jobId, outcome, summary, outputs)`, validated against the playbook's
  `outcomes` and `outputs` (all required for the first outcome). The handing-off run is
  woken with the outcome, which routes through its step's `on`. Settling one job does not end
  the run.
- **At the end of the run.** When it completes (or ends with an outcome,
  `2026-11-05-sub-playbook-outcomes.md`), the jobs still open are settled with the run's
  outcome, and their outputs are the playbook's outputs as resolved at the end of the run,
  the same for every such job. When it fails or is canceled, their hand-off steps fail, and
  are retried within `retries`: a retry hands off a new job.
- **Withdrawn jobs.** Canceling the handing-off run, or resetting its hand-off step (restart,
  `goto`), withdraws the job: it leaves its boarding run (a boarding run left with no job is
  dropped), or the running run's manager is told, and its later settlement is ignored. A
  hand-off step's `timeout` covers the whole wait, boarding included; on timeout the job is
  withdrawn and the step fails, retried within `retries`.
- **Pause.** While the handing-off run is paused, its job stays where it is; a settlement
  waits for the resume.
- Jobs survive daemon restarts (run state, as gates do).
- `validate_playbooks` checks a hand-off step against the target in the same playbooks
  folder. It refuses a hand-off that leads back to its own playbook, directly or through
  other hand-offs, since the two runs would wait on each other.

## Consequences

- A run can delegate a stage to a shared process and stay active, and visible, until its job
  is settled; the result routes like any step outcome.
- Stages in order are written in the handing-off playbook, one hand-off step per stage.
- Attempts of hand-off steps have no agent: their id is `handoff:<run>:<step>:<n>`, and they
  record the job they handed off (`job`, default `null`, so older run files load).
