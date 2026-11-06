import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { askHumanText, choicesOfGate } from "../shared/gates";
import type { Playbook } from "../shared/types";
import { newRun, requestGate } from "./engine";
import { loadPlaybooks } from "./loader";
import { Runtime } from "./runtime";
import { RunStore } from "./store";

const EXAMPLES = path.resolve(__dirname, "..", "examples");
const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const MAIN = `
title: Main
steps:
  - id: approve
    gate:
      question: Ship it?
      choices:
        approved: { label: Ship }
        rejected: { label: Request changes, comment: required, color: danger }
    on:
      rejected: fail
`;

async function playbook(): Promise<Playbook> {
  const dir = await mkdtemp(path.join(tmpdir(), "gate-question-"));
  temps.push(dir);
  const root = path.join(dir, ".paseo/playbooks");
  await mkdir(root, { recursive: true });
  await cp(path.join(EXAMPLES, ".paseo/plugins/playbooks/roles"), path.join(root, "roles"), { recursive: true });
  await writeFile(path.join(root, "main.yaml"), MAIN);
  const entry = (await loadPlaybooks(dir)).entries.find((candidate) => candidate.id === "main")!;
  expect(entry.errors).toEqual([]);
  return entry.playbook!;
}

const now = () => new Date().toISOString();

/** A manager blocked on one question and one tool permission. */
function fakePaseo() {
  const responses: Array<{ requestId: string; response: { behavior: string; message?: string } }> = [];
  const sent: string[] = [];
  const pendingPermissions = [
    { id: "q1", provider: "claude", name: "AskUserQuestion", kind: "question" },
    { id: "t1", provider: "claude", name: "Bash", kind: "tool" },
  ];
  const ref = (agentId: string) => ({
    refresh: async () => ({ agent: { id: agentId, status: "running", archivedAt: null, pendingPermissions } }),
    respondToPermission: async (input: (typeof responses)[number]) => {
      responses.push(input);
    },
    send: async (text: string) => {
      sent.push(text);
    },
  });
  return { paseo: { agents: { ref } }, responses, sent };
}

describe("gate question in chat", () => {
  it("tells the manager to ask the human with every choice of the gate", async () => {
    const run = newRun({ id: "run_q", playbook: await playbook(), workspaceId: "ws", workspaceDir: "/tmp", projectId: "p", branch: null, managerAgentId: "m", inputs: {}, now: now() });
    const gate = requestGate(run, "approve", "PR #1 is green.", now());
    const text = askHumanText(gate, choicesOfGate(gate, run.playbook.steps[0]));
    expect(text).toMatch(/AskUserQuestion/);
    expect(text).toMatch(/"approved" \(Ship\), "rejected" \(Request changes, needs a comment\)/);
    expect(text).toMatch(new RegExp(`resume for gate ${gate.id}`));
  });

  it("dismisses the manager's open question when the panel decides, and wakes it once its turn ends", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gate-question-store-"));
    temps.push(dir);
    const store = new RunStore(dir);
    await store.init();
    const run = newRun({ id: "run_q", playbook: await playbook(), workspaceId: "ws", workspaceDir: "/tmp", projectId: "p", branch: null, managerAgentId: "m", inputs: {}, now: now() });
    requestGate(run, "approve", "PR #1 is green.", now());
    await store.create(run);
    const fake = fakePaseo();
    const runtime = new Runtime(store);
    await runtime.attach(fake.paseo as never);

    await runtime.decideGate("run_q", "approve", { decision: "approved", comment: null, by: "laptop", via: "panel", now: now() });
    expect(fake.responses).toEqual([{ requestId: "q1", response: { behavior: "deny", message: expect.stringMatching(/decided gate approve-1 in the Playbooks panel instead: approved/) } }]);
    expect(fake.sent).toEqual([]);

    await runtime.onManagerTurnEnded("m");
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatch(/Gate approve approved by laptop via panel/);
  });
});
