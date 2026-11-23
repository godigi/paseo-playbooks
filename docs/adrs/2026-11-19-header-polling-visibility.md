# Header polling and page visibility

## Status
Accepted

## Context
Workspace snapshots and upserts arrive in bursts. Refreshing all header buttons on every event repeats RPCs, including while a browser tab is hidden. Current main still refreshes on every upsert and polls hidden pages.

## Decision
Batch new workspace queries for 300 ms and allow one header request at a time. Known workspace updates wait for the 10-second full poll. Hidden browser pages defer refreshes until visible, when a full refresh catches up. Native clients without a page document remain active. Failed requests retry with the next full poll. Disposal releases observation, timers and visibility listeners and ignores late answers.

## Consequences
Header state may lag by one poll interval. Bursts and background pages issue fewer RPCs, while newly visible pages catch up promptly. No run execution or recovery behavior changes.
