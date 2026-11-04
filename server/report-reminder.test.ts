import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AttemptSchema } from "../shared/types";
import { newRun, startAttempt } from "./engine";
import { loadPlaybooks } from "./loader";
import { Runtime } from "./runtime";
import { RunStore } from "./store";

const EXAMPLES = path.resolve(__dirname, "..", "examples");
const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const PLAYBOOK = `
title: Release
steps:
  - id: release
    role: implementer
    outputs: { pr: {} }
`;

/** Just enough of the daemon API for a step's turn end; the step agent is running when the runtime attaches. */
function fakePaseo(lastText: string, failSend = false) {
  const sent: Array<{ agentId: string; text: string }> = [];
  const ref = (agentId: string) => ({
    refresh: async () => ({ agent: { id: agentId, status: agentId === "m" ? "idle" : "running", provider: "claude", model: null, archivedAt: null } }),
    send: async (text: string) => {
      if (failSend && agentId === "step-1") throw new Error("agent closed");
      sent.push({ agentId, text });
    },
    timeline: { refetch: async () => ({ entries: [{ item: { type: "assistant_message", text: lastText } }] }) },
  });
  return { paseo: { agents: { ref } }, sent };
}

async function setup(options: { lastText?: string; failSend?: boolean } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "reminder-"));
  temps.push(dir);
  const root = path.join(dir, ".paseo/playbooks");
  await mkdir(root, { recursive: true });
  await cp(path.join(EXAMPLES, ".paseo/plugins/playbooks/roles"), path.join(root, "roles"), { recursive: true });
  await writeFile(path.join(root, "release.yaml"), PLAYBOOK);
  const playbook = (await loadPlaybooks(dir)).entries.find((entry) => entry.id === "release")!.playbook!;
  const store = new RunStore(path.join(dir, "runs"));
  await store.init();
  const run = newRun({ id: "run_x", playbook, workspaceId: "ws", workspaceDir: dir, projectId: "p", branch: null, managerAgentId: "m", inputs: {}, now: new Date().toISOString() });
  startAttempt(run, "release", { agentId: "step-1", brief: "", now: new Date().toISOString(), readonlySnapshot: null });
  await store.create(run);
  const fake = fakePaseo(options.lastText ?? "report_step_result was not found. PR: https://x/pr/1", options.failSend);
  const runtime = new Runtime(store);
  await runtime.attach(fake.paseo as never);
  return { store, runtime, ...fake };
}

describe("a step that ends its turn without reporting", () => {
  it("is asked once to report before the manager is woken", async () => {
    const { store, runtime, sent } = await setup();
    await runtime.onTurnEnded("step-1", "completed");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ agentId: "step-1" });
    expect(sent[0]!.text).toMatch(/call report_step_result now/);
    const state = store.get("run_x")!.steps.release!;
    expect(state.status).toBe("running");
    expect(state.attempts[0]!.reminded).toBe(true);

    // The reminder turn reports: the manager gets the report.
    await runtime.report("step-1", { outcome: "success", summary: "done", outputs: { pr: "https://x/pr/1" } });
    await runtime.onTurnEnded("step-1", "completed");
    expect(store.get("run_x")!.steps.release!.status).toBe("reported");
    expect(sent.map((entry) => entry.agentId)).toEqual(["step-1", "m"]);
    expect(sent[1]!.text).toMatch(/reported success: done/);
  });

  it("wakes the manager with the fallback when it still does not report", async () => {
    const { store, runtime, sent } = await setup();
    await runtime.onTurnEnded("step-1", "completed");
    await runtime.onTurnEnded("step-1", "completed");
    expect(store.get("run_x")!.steps.release!.status).toBe("reported");
    expect(sent.map((entry) => entry.agentId)).toEqual(["step-1", "m"]);
    expect(sent[1]!.text).toMatch(/even after the plugin asked it to/);
    expect(sent[1]!.text).toMatch(/call complete_step with them/);
    expect(sent[1]!.text).toMatch(/PR: https:\/\/x\/pr\/1/);
  });

  it("wakes the manager directly when the turn failed or the reminder cannot be sent", async () => {
    const failed = await setup();
    await failed.runtime.onTurnEnded("step-1", "failed");
    expect(failed.sent.map((entry) => entry.agentId)).toEqual(["m"]);
    expect(failed.sent[0]!.text).toMatch(/ended \(failed\) without reporting\. Last message/);

    const unsent = await setup({ failSend: true });
    await unsent.runtime.onTurnEnded("step-1", "completed");
    expect(unsent.sent.map((entry) => entry.agentId)).toEqual(["m"]);
    expect(unsent.store.get("run_x")!.steps.release!.status).toBe("reported");
  });

  it("reads run files written before the reminder existed", () => {
    const attempt = { n: 1, agentId: "a", startedAt: "t", endedAt: null, brief: "", inputs: {}, report: null, lastMessage: null, outcome: null, turnEnd: null, readonlySnapshot: null };
    expect(AttemptSchema.parse(attempt).reminded).toBe(false);
  });
});
