# Manager instructions from the playbooks and the repository

Status: Accepted

## Context

Step agents get repo-specific instructions from their role (`roles/<id>/instructions.md`) and
from the step's `role: { prompt }`. The Playbook Manager gets none: its instructions are the
fixed `MANAGER_PROTOCOL` in `server/prompts.ts`, and the defaults' `manager:` block only holds
agent settings (`provider`, `model`, `mode`, `thinking`). A repository cannot tell the manager
how to brief steps, what to check before a gate, or what to tell the human.

A manager role was considered and rejected. A role describes the agent a step runs as: its
`title`, `readonly` and `agent` settings mean nothing for the manager, whose title is fixed,
which never edits files, and which is often an existing agent taking a run over (so agent
settings do not apply). Only the instructions would be used, and calling it a role would
suggest the protocol can be replaced. The protocol is the manager's contract with the tools
and must stay.

## Decision

- A playbook may declare `manager: { prompt: | … }`. The block follows the block-first rule
  (`2026-11-06-group-step-kind-fields.md`) and is `.strict()`, so later manager options go in
  it.
- The repository may hold `defaults/manager.md`, repo-wide instructions for every run's
  manager. The defaults' `manager:` block keeps only agent settings; prose goes in the file,
  as a role's goes in `instructions.md`. An empty file is an error, like an empty
  `instructions.md`.
- The texts are added after `MANAGER_PROTOCOL`, never instead of it, as a list with one entry
  per non-empty text:

  ```
  Instructions for this run (they add to the rules above, never replace them):
  - repository: <defaults/manager.md>
  - <playbook id>: <its manager.prompt>
  - <sub-playbook id>: <its manager.prompt>
  ```

  The repository entry comes first, then the root playbook, then each sub-playbook it uses
  (in steps or after-tasks, at any depth) in the order they first appear. A playbook used
  several times is listed once. A hand-off's singleton is not included: its trains have
  their own managers. A sub-playbook's text applies to the whole run, not only while its
  block runs: the manager sees the whole list when it takes the run.
- The list reaches the manager when it takes the run: in `start_playbook`'s result (which
  covers a manager created by Start, whose kickoff calls it, and any agent starting a run
  from chat), in the takeover prompt of an existing run, and in a train's kickoff. A train's
  list holds the repository's, the singleton's and its own station's sub-playbooks' texts.
- The texts are read when the playbook loads, as part of the loaded `Playbook`. A run keeps
  the playbook it started with, so editing them affects new runs only; a takeover of an
  existing run uses the run's copy.
- The run's stored playbook gains the texts (optional, so older run files still load). The
  agent tools' contract is unchanged.

## Consequences

- Repositories can steer the manager without forking the plugin, at repo, playbook and
  sub-playbook level.
- A sub-playbook can add instructions to a parent's manager. The `<playbook id>:` label shows
  where each one comes from, so the manager (and a human reading its conversation) can tell
  them apart.
- The manager can be told things that contradict the protocol. The protocol stays first and
  the docs say the instructions add to it; nothing enforces it.
- Runs started before the upgrade have no texts and behave as today.
- The loader, `shared/types.ts`, `server/prompts.ts`, the skill, README, website reference and
  examples document and test the new block and file.
