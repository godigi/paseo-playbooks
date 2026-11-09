# Slim overview state

## Status

Accepted

## Context

`overview.state` returned every non-archived run in full. A run weighs up to 200 KB (history,
attempts, prompts, outputs), so with about 30 active runs one call was about 3.5 MB, and the
client refetched it after every batch of agent events. Over the relay the call took about 19 s,
which made the Playbooks screen close to unusable.

## Decision

- `overview.state` returns `RunSummary` objects: the fields the Playbooks screen, its sidebar
  badge and the header read (status, timestamps, step statuses, the playbook's step titles and
  stations, pending gates reduced to a summary line, jobs reduced to label, status and waiting
  list). `summarizeRun` in `shared/summary.ts` builds them.
- The call takes `since` and returns a `version` (a hash of the summaries). When `since` equals
  the current version, `runs` is null and the client keeps what it holds.
- `runs.get` returns one run in full. The screen calls it when the user opens Review on a gate,
  which needs the playbook's steps and the full gate.
- The client batches agent events over 3 s (was 1 s). Most events do not change the list, so the
  refresh is then a version check of a few bytes.

## Consequences

- Measured on 34 real runs: 3.46 MB before, 50 KB after (largest summary 2 KB); an unchanged
  poll is 27 bytes.
- New screen features that need more of a run add the field to `RunSummarySchema` or fetch it
  with `runs.get`; they do not read it from the overview state.
- `runs.list` (the workspace panel) still returns full runs, scoped to one workspace.
