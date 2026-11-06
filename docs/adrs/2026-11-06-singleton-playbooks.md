# Singleton playbooks: a waiting list per key, departing when a slot is free

Status: Superseded by `2026-11-06-singleton-pipelines.md`

## Specification changes

| Change                          | Where               | Kind    | Summary                                                                 |
| ------------------------------- | ------------------- | ------- | ----------------------------------------------------------------------- |
| `singleton`                     | playbook            | new     | A block (`{}` for the defaults): the playbook takes jobs               |
| `singleton.branch`              | playbook            | new     | Branch its runs branch off (default: the project's default branch)      |
| `singleton.concurrency.key`     | playbook            | new     | Inputs that are the run's; the others are each job's                    |
| `singleton.concurrency.limit`   | playbook            | new     | Running runs per key value (default: no limit)                          |
| `concurrency`                   | playbook            | changed | Refused on a singleton playbook (use `singleton.concurrency`)           |
| `inputs`, `outputs`, `outcomes` | playbook            | changed | On a singleton: each job's, except the key inputs (the run's)           |
| `{{ run.jobs }}`                | prompts             | new     | The run's open jobs, as YAML                                            |
| `PLAYBOOK_JOBS`                 | script steps        | new     | The run's open jobs, as JSON                                            |
| `boarding`                      | run status          | new     | A run gathering jobs, before it departs                                 |
| `start_playbook`, Start         | manager tool, panel | changed | On a singleton: create or join the boarding run of the key              |
| `playbook:` steps, `after:`     | playbook            | changed | Refuse a singleton playbook                                             |
| `restart_run`                   | manager tool        | changed | On a singleton run: carries only the jobs still open                    |

## Context

Some work is not done by each run on its own but on a shared resource, together with the
work of other runs. For example: many runs each produce a change, and the changes are applied
and checked on an environment in groups, one group at a time per environment, while the next
group fills up.

`concurrency` limits the active runs of a playbook in the project, for all of them at once
(not per resource), and work waiting for a slot stays one run's: nothing gathers the work of
other runs into it while it waits. Grouping and starting are deterministic, so the plugin
does them, as it runs script steps (`2026-11-05-script-steps.md`); no long-lived agent
supervises the runs. Runs hand work over with hand-off steps
(`2026-11-06-handoff-steps.md`).

## Decision

A playbook that declares `singleton:` takes jobs from other runs. Per project and per value
of its key, it has at most one **boarding** run, whose jobs are the **waiting list**, and as
many running runs as its limit allows.

```yaml
# apply.yaml
title: Apply
singleton:
  branch: main              # runs branch off it (default: the project's default branch)
  concurrency:
    key: [env]              # the run's inputs; the others are each job's
    limit: 1                # running runs per key; the others wait on the list

inputs:
  env: { type: enum, values: [dev, stg, prd], required: true }   # in the key: the run's
  pr_urls: { type: string, required: true }                      # not in the key: each job's
outputs:
  report: { type: string }              # each job's
outcomes: [done, rejected]              # each job's

steps:
  - id: apply
    inputs: [env]
    role:
      name: applier
      prompt: |
        Apply these jobs to {{ inputs.env }}:
        {{ run.jobs }}
```

- **Off by default.** Without `singleton:`, a playbook is an
  ordinary one, as today: it takes no jobs and cannot be the target of a hand-off.
- **Always a block** (`2026-11-06-group-step-kind-fields.md`): `singleton: true` or `false` is
  refused with the form to write.
- **`singleton: {}`** takes every default: the project's default branch, no key, no limit.
- **`singleton.concurrency`** is the singleton's limit, per key value. A singleton playbook
  may not also set the top-level `concurrency`, which keeps its meaning for other playbooks;
  validation points to `singleton.concurrency`.
- **The run's and each job's.** The playbook's inputs in `singleton.concurrency.key` are the
  run's: steps read them as `{{ inputs.env }}`. Its other inputs are each job's: steps read
  them through `{{ run.jobs }}`, and validation refuses wiring them into a step (one value per
  job). Its `outputs` and `outcomes` are each job's (`2026-11-06-handoff-steps.md`); its
  outputs need no source, since `settle_job` gives them. Without a key, every input is each
  job's, and there is one boarding run for the project.
- **Boarding.** A hand-off adds its job to the boarding run for its key values. If there is
  none, the plugin creates it. A boarding run is a new run status, `boarding`: it has inputs
  and jobs, but no worktree, manager or step started yet.
- **Departure.** When the key's running runs are below the limit, the boarding run departs
  at once if it has at least one job: the plugin creates its worktree from `branch` and its
  own Playbook Manager, then sends the manager its kickoff with the jobs. The run takes no
  more jobs; later hand-offs create the next boarding run. The run's playbook is read from its
  worktree, so a merged change applies from the next run, and a branch that edits the
  playbook does not change the shared process; a job whose inputs do not fit that copy fails
  its hand-off.
- **Running.** The run is an ordinary run with an ordinary manager in its own worktree.
  `{{ run.jobs }}` gives its steps, the steps of its sub-playbook blocks included, the open
  jobs as YAML, one entry per job with its id, inputs and outputs so far; script steps get the
  same as JSON in `PLAYBOOK_JOBS`. Settled jobs are left out.
- **Start** in the panel (and `start_playbook`) on a singleton playbook creates or joins the
  boarding run for the given key, and that run departs as above even without a job. The
  caller does not become its manager.
- **Not included.** A singleton playbook's runs only come from hand-offs and Start: it cannot
  be a sub-playbook step (`playbook:`) or an after-task. It may include hidden sub-playbooks,
  which are not singletons themselves.
- **Without a limit**, every boarding run departs at once: each job runs on its own, and
  nothing waits or is grouped.
- **Restart.** Restarting a singleton run (`restart_run`) keeps it in its lane and carries
  only its jobs still open; settled jobs, and jobs whose hand-off steps already failed, stay
  out of it.

## Consequences

- Work from many runs is grouped and handled on a shared resource one group at a time per key,
  by plugin rules, without agents waiting on each other through prompt rules and without a
  long-lived agent: every run has its own, ordinary manager, so no context grows run after
  run.
- When a group departs is fixed: as soon as the key has a free slot. Holding work back (a
  time window, a minimum size, a human go) is written as steps of the run, such as a gate at
  its start.
- There is no single agent to talk to about all the runs of a singleton playbook; the
  Playbooks screen's lanes give the overview (`2026-11-06-singleton-lanes-ui.md`), and each
  run's manager answers for its run.
- The top-level `concurrency` is unchanged. A singleton's key and limit live in
  `singleton.concurrency`, because its key also splits the inputs between the run and each
  job, which only means something for a singleton. The name `singleton` stays although the
  limit may be above 1: what is single is the waiting list per key.
- Additive format change: existing playbooks and runs keep working (runs gain `jobs` and
  `departEmpty`, with defaults). Older plugin versions refuse playbooks that use it.
- A departure interrupted by a daemon restart, between creating the worktree and recording
  the departure, departs again with a new worktree; the first one is left to archive.
