# Step kind fields grouped under the kind keyword; block form first

Status: Accepted

## Context

A step's kind is picked by one keyword whose value is a plain string (`role: reviewer`,
`gate: "…"`, `playbook: release`, `script: wait_ci`; `2026-11-05-script-steps.md` keeps "the
key is the kind", no `type:` field). The options that only apply to one kind are flat
siblings of that keyword:

| Kind     | Kind-only fields                                   | Shared with another kind          |
| -------- | -------------------------------------------------- | --------------------------------- |
| agent    | `prompt`, `silence`, `archive_agents`, `agent`     | `outputs`, `outcomes`, `timeout`  |
| script   | `poll`                                             | `outputs`, `outcomes`, `timeout`  |
| gate     | `choices`                                          | —                                 |
| playbook | — (the sub-playbook defines the rest)              | —                                 |

`id`, `title`, `short_title`, `needs`, `inputs`, `retries` and `on` apply to every kind (an
after-task adds `trigger`). The loader refuses a field on the wrong kind with a message
naming the kind. `defaults/main.yaml` holds `timeout`, `silence` and `archive_agents` flat.

A parallel branch introduces a playbook-level `singleton: { isolation_level, branch,
parallel }` block instead of flat top-level fields. Grouping the step kinds the same way
gives the format one style for settings, shows a field's kind from its indentation, and
lets a new kind-only option be added without a top-level step key that every other kind
must refuse.

Against it: every playbook breaks, the common agent step gets one level deeper, the loader
already catches misplaced fields, and `on` transitions keep a keyword with flat siblings
(`{ ask, goto, choices }`). Accepting both forms for a while is ruled out by
`2026-11-03-format-stability-until-v1.md`, and after v1.0 this change would need a major
version, so it is cheapest now.

## Decision

- Each step kind is a block; the plain-string form is no longer valid:

  ```yaml
  - id: review
    role: { name: reviewer, prompt: "…", silence: 30m, archive_agents: false, agent: { model: … } }
  - id: approve
    gate: { question: "Ship it?", choices: { ship: ~, hold: { comment: required } } }
  - id: wait_ci
    script: { run: wait_ci, poll: 30s }
  - id: release
    playbook: { name: release }
  ```

- `role` takes `name` (required), `prompt`, `silence`, `archive_agents` and `agent`. `gate`
  takes `question` (required) and `choices`. `script` takes `run` (required) and `poll`.
  `playbook` takes `name` (required). The loader refuses unknown keys in each block.
- `outputs`, `outcomes` and `timeout` stay on the step: agent and script steps share them.
  `id`, `title`, `short_title`, `needs`, `inputs`, `retries`, `on` and an after-task's
  `trigger` stay on the step too. The existing refusals (`timeout` on a gate, `outputs` on a
  playbook step, …) are unchanged.
- `defaults/main.yaml` moves `silence` and `archive_agents` under `role:`; `timeout`,
  `agent` and `manager` stay where they are.
- Hard break, per `2026-11-03-format-stability-until-v1.md`. The old forms fail with what to
  write instead:
  - a string kind: `` role: write `role: { name: reviewer }` ``;
  - a flat moved field: `` `poll` moved under `script:`: write `script: { run: wait_ci, poll: 30s }` ``;
  - the same for `prompt`, `silence`, `archive_agents`, `agent` and `choices`, and for
    `silence` and `archive_agents` in the defaults file.
- The same rule applies to every new element of the format: a feature's options go in one
  block under a key named for the feature, never as flat siblings, even when it has a single
  option today. A field stays flat only when it describes its parent itself (`id`, `title`,
  `hidden`, `needs`) or is shared by several step kinds. A default mirrors the block it
  defaults. `.agents/skills/extend-playbook-format/SKILL.md` describes how to add one, and
  `AGENTS.md` points to it.
- Only the YAML changes: the loaded `Step` and `Playbook` types, the run state and the
  agent tools stay as they are.

## Consequences

- Every playbook, `defaults/main.yaml` that sets `silence` or `archive_agents`, the examples
  and this repository's own `.paseo/plugins/playbooks/`, the README, the website reference
  and examples, and `skills/paseo-playbooks/SKILL.md` must be rewritten. The pull request
  carries `breaking-change` and the migration.
- Run files are unaffected, so runs started before the upgrade keep going.
- Kind-only options are grouped by shape, but the step still has shared fields beside the
  block, and `on` transitions keep the flat keyword style.
- The common agent step is one level deeper (`role: { name: …, prompt: … }`, usually written
  as a nested map).
- Existing flat forms outside step kinds (`on` transitions such as `{ ask, goto, choices }`)
  are not changed by this ADR; a later change to them follows the block rule.
