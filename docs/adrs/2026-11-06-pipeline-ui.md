# A singleton pipeline in the UI: its stations and its trains

Status: Superseded by `2026-11-06-pipeline-card-layout.md`

Supersedes `2026-11-06-singleton-lanes-ui.md`.

## Context

A singleton is now a pipeline whose top-level steps are stations
(`2026-11-06-singleton-pipelines.md`). Its work is the stations' waiting lists and the trains
running at each station, all in one shared workspace.

## Decision

- **Stations view.** Where a pipeline is shown (its card in the workspace panel, its group on
  the Playbooks screen), it is drawn as its stations side by side, in file order: each one's
  queue mode, its **waiting list** (the jobs waiting there, oldest first, labelled with the
  handing-off run), and its current **train** (or the last one).
- **Trains.** A train is listed under its singleton, not as a playbook of its own: in the
  panel as a run of the singleton's card (selecting it shows its graph, the station's steps),
  and on the Playbooks screen as a row of the singleton's group, each with its own columns.
  Selecting a station's train in the stations view opens it.
- **Hand-off steps.** A hand-off node reads "Hand-off → <singleton>" and, while it waits,
  where its job is: waiting at a station, or on a station's train. Its details sheet shows
  the singleton, the job and the pipeline.
- A step with `when` shows its condition on its node and in its details; a skipped step is
  drawn as skipped (unchanged).

## Consequences

- One place shows the whole process: stations, waiting lists and trains, without a graph
  of steps that would never run as a whole.
- The running train's live graph is not drawn inside the handing-off run's hand-off node: the
  panel only knows its own workspace's runs. That can come later with an RPC that returns one
  run by id.
