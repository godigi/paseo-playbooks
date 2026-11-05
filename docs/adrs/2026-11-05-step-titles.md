# Step titles: a full name and a short name beside the id

Status: Accepted

## Context

A step had only an `id`. Every display used it, capitalised (`stepLabel`): the step's details,
its graph node, the Playbooks screen columns, gate destinations and statuses. Ids are written
for wiring (`steps.<id>.outputs.x`, `needs`, `goto`), so they are short and lowercase. A
readable name is often too long for a column, and a short one is too terse for the details.
Playbooks, roles, after-tasks and sub-playbook blocks already have a `title`.

## Decision

- Two optional step keys:
  - `title`: the full name, used in the step's details, on its graph node, and wherever a step
    is named in a sentence (gate destinations, "Ready for you: …", "Failed at …", the Needs you
    rows).
  - `short_title`: the name in the Playbooks screen's step columns.
- If a step has no `short_title`, the columns use its `title`. If it has no `title`, the old
  label, `stepLabel(id)`, is used.
- `id` stays the identifier. Its rule (lowercase letters, digits, `-` and `_`) does not change.
- On a playbook step, `title` names the block's frame (default: the sub-playbook's title).
  `short_title` is refused there, because the block's own steps are the columns. On an
  after-task, `title` keeps its earlier meaning: the task's name.
- Run state stores both as optional fields of the step (`title`, `shortTitle`), so runs
  saved before this change still load and show their old labels.

## Consequences

- An additive format change: existing playbooks keep their labels.
- Two fields to keep in step with the step's meaning. A stale title can mislead, where an
  id could not drift from itself.
- The agent tools still name steps by id; titles are display only.
