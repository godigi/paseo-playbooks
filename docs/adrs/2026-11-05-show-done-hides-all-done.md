# Show done hides every done run

Status: Accepted. Supersedes the **Show done** rule of `2026-11-05-overview-status-and-seen.md`.

## Context

**Show done** only hid done runs already opened. Done runs not opened yet (green) were listed
whatever the chip's state, so with a few of them on screen the chip looked broken.

## Decision

- With **Show done** off, the Playbooks screen hides every done run, opened or not. Working,
  waiting, paused, failed and canceled runs, and runs still wrapping up (after-tasks running),
  stay listed.
- The header's done count still counts every done run in the current project and workspace
  filter, so new ones are not missed.
- Seen state is unchanged: a done run is green until opened, grey after.

## Consequences

- A newly finished run leaves the list until **Show done** is turned on; the count tells you it
  is there.
