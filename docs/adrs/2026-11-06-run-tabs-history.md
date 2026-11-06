# Panel: grouped run dots, and a History menu for finished runs

Status: Accepted. Supersedes the "one status dot per run" rule of
`2026-11-02-panel-refresh-on-agent-events.md`.

## Context

A playbook card showed one dot per run in its header and one tab per run inside. Playbooks
that run often, such as a singleton's trains, filled both rows with finished runs nobody needs
to look at again, and the run that needed a human could end up anywhere in the row.

## Decision

- **Dots by status.** The header shows one dot per status that has runs, most urgent first:
  waiting (yellow), running (blue), failed or canceled (red), done and not opened (green),
  done and opened (grey). A dot reads its count when more than one run has that status. It
  pulses while one of its runs moves (not paused). Pressing it opens that status's first run.
- **Tabs for what needs a look.** A run has a tab while it is active, or finished and not
  opened yet. Tabs are sorted the same way, newest first within a status, up to 6.
- **History.** Other runs go in a "History (n)" menu after the tabs: the tabs past 6 first,
  then the shelved runs, newest first. A run is shelved once finished and opened (from the
  panel or the Playbooks screen), or finished for over 24 hours even if not opened. The selected
  run keeps its tab, even if it comes from History.
- **Shorter tab labels.** A tab no longer writes its status; its colour says it, and its
  accessibility label still does. "wrapping up" and "paused" are still written.

## Consequences

- The header and tab rows stay about the same width however many runs a playbook has.
- Opening a finished run sends it to History once another tab is selected.
- Shelving is computed in the panel; nothing is archived on the daemon.
