# Singleton lanes and hand-off steps in the UI

Status: Superseded by `2026-11-06-pipeline-ui.md`

## Context

A singleton playbook's work (`2026-11-06-singleton-playbooks.md`) is spread over runs in
their own worktrees: boarding runs with their waiting lists, and running runs. A hand-off step
(`2026-11-06-handoff-steps.md`) waits on one of them. Both must be visible, not hidden behind a
single node.

## Decision

- **Lanes on the Playbooks screen.** A singleton playbook's group shows one lane per key
  value (every value of an enum key, even empty, else the values seen so far; one lane
  without a key), side by side. Each lane shows its **waiting list** (the boarding run's
  jobs, each labelled with the handing-off run) and its **running** runs (open jobs and
  progress). The group's rows list its runs as for any playbook; a boarding run's row reads
  "Waiting list: N job(s)" and has no workspace or manager to open yet.
- **Hand-off steps in the graph.** A hand-off node reads "Hand-off → <playbook>" and, while it
  waits, where its job is: on which boarding run, then on which run it departed. Its details
  sheet shows the target, the job and the run carrying it, and the result once settled.
- **Conditions.** A step with `when` shows its condition on its node ("if env=prd") and in its
  details; a skipped step is drawn as skipped.
- The `boarding` run status reads "waiting list", in the waiting colour.

## Consequences

- The singleton's runs, waiting lists and lanes are visible in one place, and each run still
  has its own graph in its worktree's panel.
- The running run's live graph is not drawn inside the hand-off frame of the handing-off run:
  its panel only knows its own workspace's runs. That can come later with an RPC that returns
  one run by id.
