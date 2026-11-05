# Script steps: deterministic work run by the plugin

Status: Accepted

## Context

Some steps need no judgment: wait until a PR merges, until the dev lane is clear, until a
deploy finishes. Agent steps did that waiting themselves (background polls, then ending the
turn), which spends turns, outlives plugin reloads (`2026-11-04-report-reminder.md`), and
reads as "waiting for manager" when the turn ends without a report. The manager is then woken
for a step that is not blocked on it, and the step's timeout lives only in its prompt.

The original design (`2026-11-02-design.md`, section 1) gives deterministic work to the plugin
and judgment to the agents. Waiting is deterministic.

## Decision

- A fourth step kind, `script: <file>`, beside `role`, `gate` and `playbook`. The key is the
  kind, as for the other three (no `type:` field). `poll: <duration>` applies only to it.
- The file is a plain name in the playbook folder's `scripts/`, versioned with the playbooks
  that use it. The validator checks it exists and is executable. Its shebang picks the
  language; the plugin knows no interpreters.
- The plugin starts a ready script step itself (the manager never calls `start_step` for it;
  `start_step` and `nudge_step` refuse it) and completes it from the result. The manager is
  woken with the outcome and what is ready next, not before.
- Contract: the script runs in the run's worktree. Inputs come as `PLAYBOOK_INPUT_<NAME>`
  environment variables (plus run, step, attempt, check and feedback), never interpolated into
  a command. Exit `0` = done, `75` = not yet (rerun after `poll`), anything else = `failure`.
  The last stdout line may be a JSON object with `outcome`, `summary` and `outputs`, validated
  like an agent's report.
- Each check runs once and exits; the plugin waits between checks. After a daemon restart it
  reruns the current check, so checks must be idempotent. `timeout` covers the whole attempt.
- Attempts of script steps have no agent: their id is `script:<run>:<step>:<n>`. Attempts
  record `checks` and `nextCheckAt` (defaults `0` and `null`, so older run files load). The
  last output (stdout then stderr, capped) is kept in `lastMessage`.
- A failure with retries left runs again without waking the manager. While the run is paused,
  a script keeps checking but its result waits for the resume. Cancel, fail and `goto` resets
  kill it.
- The panel shows script steps with a "Script · check N" subtitle; their details sheet shows
  the script, its interval, checks, next check and output, and no conversation or nudge.

## Consequences

- Waits become playbook steps (`wait_dev_lane` before `dev_release`), checked by code instead
  of a rule in a role's prompt, and cost no tokens while they wait.
- Scripts run unattended with the daemon's environment and credentials, as decision 47
  already accepts for agent steps; only trusted repositories should be started.
- The concurrency rule does not see scripts: they must not edit the checkout.
- The format change is additive: existing playbooks and runs keep working.
