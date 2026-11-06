# A singleton's card: stations on top, trains as tabs

Status: Accepted

Supersedes `2026-11-06-pipeline-ui.md`.

## Context

`2026-11-06-pipeline-ui.md` listed a singleton's pipeline as one more run of its card, next to
its trains. In use, the card showed two chips that read the same ("616b1c · running",
"28749a · running") for things of different kinds: the pipeline is one long-lived run that never
completes, the trains are the runs that do the work. The Playbooks screen stretched the three
stations across the whole width and its header read "1  1 working".

## Decision

- **Panel card of a singleton.** The stations are always drawn at the top of the card (each
  one's queue mode, waiting list and current or last train), under a "Stations" label with a
  "Pipeline · N jobs" chip that holds the pipeline's details, Pause and Cancel. The pipeline is
  not a tab. The tabs are Definition and the trains, each named by its station:
  "Dev train · 616b1c · running". Selecting a train (a tab, or its train in a station) shows its
  graph below. The card title is the singleton's, whichever tab is selected.
- **Playbooks screen.** A singleton's group shows its stations as fixed-width cards, its header
  reads "N jobs · M trains running", and its list is titled "Trains", with rows named
  "Dev train · 1 job".
- **Progress lines.** A step that its `when` skipped is left off a run's line (a dev train's
  line is Release, Merge, QA, Done: no Prd go, no Close).
- Unchanged from `2026-11-06-pipeline-ui.md`: hand-off nodes read "Hand-off → <singleton>" with
  where the job is, and their details sheet shows the singleton, the job and the pipeline; a
  step with `when` shows its condition on its node and in its details.

## Consequences

- A pipeline and its trains can no longer be mistaken for two runs of the same playbook.
- The pipeline has no graph of its own anywhere: its stations are its view.
- The running train's live graph is still not drawn inside the handing-off run's hand-off
  node (it needs an RPC that returns one run by id).
