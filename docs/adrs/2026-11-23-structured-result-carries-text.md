# Tool results carry their text in structuredContent

## Status

Accepted.

## Context

Claude Code shows a tool's `structuredContent` and drops the content text when both exist. Playbooks tools that returned `ok(text, result)` therefore showed Claude callers only the structured part. For `read_agent_conversation` that left `agentId`, `hasOlder`, `before` and an entry count, and the transcript never arrived. Other tools lost their main sentence the same way (gate decided, run state and ready steps, restart notes).

## Decision

`ok(text, structured)` in `server/tools.ts` adds the text to a structured object as `text`. It leaves the result alone when it already has its own `text` field, or when the text only repeats the result as JSON. A non-object result is wrapped as `{ text, result }`. `read_agent_conversation` sets `text` to the rendered conversation itself, without the paging JSON that its content text still ends with.

## Consequences

- Claude callers get the same information as other callers. Structured results of these tools gain a `text` field; consumers that read other fields are unaffected.
- Results that repeat their JSON as text stay the same size.
- A new tool that needs a field named `text` of its own sets it explicitly, and it wins.
