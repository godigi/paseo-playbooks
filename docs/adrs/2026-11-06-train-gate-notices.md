# Train gates are announced to the runs whose jobs they carry

Status: Accepted

## Context

A train of a singleton pipeline (`2026-11-06-singleton-pipelines.md`) is its own run: its
gates and asks are decided by a human there, in the Playbooks panel. The run that handed a job
off waits on its hand-off step and hears nothing until the job leaves the pipeline. Its manager
is often the one that talks to the human (a chat, a Slack thread), so that human never learns
that a train carrying their job waits for a decision.

## Decision

- When a train opens a gate or an ask, the plugin wakes the manager of every active run whose
  job rides that train, with the gate's text, the train, how many other jobs it carries, and
  where it is decided: the Playbooks panel, on the singleton's card. The hand-off step's line
  in the panel says it waits for a human there.
- When the gate is decided (or the train ends first), those managers are told the decision, by
  whom, and its comment.
- The decision stays with the train. A handing-off run's manager cannot `resume` it: one train
  carries jobs of several runs, and one decision covers them all.
- Each gate is announced once. Gates already open when the daemon restarts are not announced
  again; only their decision is.

## Consequences

- A manager that reports to a thread can relay the gate there and point to the panel, without
  the run state or tools changing.
- Deciding a train's gate from a thread would need cross-run `resume`: not done, and would be
  a later decision.
- The manager protocol (item 9) tells managers to pass these notices on and never to resume
  them.
