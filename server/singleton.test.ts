import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPlaybooks } from "./loader";
import { Runtime } from "./runtime";
import { RunStore } from "./store";

const EXAMPLES = path.resolve(__dirname, "..", "examples");
const temps: string[] = [];
const runtimes: Runtime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Just enough of the daemon API: idle agents, recorded prompts, and worktrees that share the test folder. */
function fakePaseo(dir: string) {
  const sent: Array<{ agentId: string; text: string }> = [];
  const created: Array<{ title: string; source: unknown }> = [];
  const archived: string[] = [];
  let agents = 0;
  const ref = (agentId: string) => ({
    refresh: async () => ({ agent: { id: agentId, status: "idle", provider: "claude", model: null, archivedAt: null, pendingPermissions: [] } }),
    send: async (text: string) => void sent.push({ agentId, text }),
    reload: async () => undefined,
    archive: async () => void archived.push(agentId),
  });
  const createAgent = async () => {
    const id = `mgr${++agents}`;
    return { id, send: async (text: string) => void sent.push({ agentId: id, text }) };
  };
  const workspace = (id: string) => ({ id, projectId: "p", workspaceDirectory: dir });
  const paseo = {
    agents: { ref },
    workspaces: {
      ref: (id: string) => ({ refresh: async () => workspace(id), agents: { create: createAgent } }),
      create: async (input: { title: string; source: unknown }) => {
        created.push(input);
        return { id: `wt${created.length}`, agents: { create: createAgent } };
      },
    },
  };
  return { paseo, sent, created, archived };
}

const APPLY = `
title: Apply
singleton: { branch: main }
inputs:
  pr_url: { type: string, required: true }
outputs:
  report: { type: string }
outcomes: [done, rejected]
steps:
  - id: dev
    gate: { question: Applied on dev? }
    queue: { mode: merge }
    retries: 1
  - id: prd
    needs: [dev]
    gate: { question: Applied on prd? }
`;

const PR = `
title: PR
inputs:
  pr_url: { type: string, required: true }
steps:
  - id: apply
    handoff: { name: apply }
    inputs: { pr_url: ~ }
    on:
      rejected: fail
`;

async function setup(files: Record<string, string> = { "apply.yaml": APPLY, "pr.yaml": PR }) {
  const dir = await mkdtemp(path.join(tmpdir(), "singleton-"));
  temps.push(dir);
  const root = path.join(dir, ".paseo/plugins/playbooks");
  await mkdir(root, { recursive: true });
  await cp(path.join(EXAMPLES, ".paseo/plugins/playbooks/roles"), path.join(root, "roles"), { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(root, name), body);
  const store = new RunStore(path.join(dir, "runs"));
  await store.init();
  const fake = fakePaseo(dir);
  const runtime = new Runtime(store);
  runtimes.push(runtime);
  await runtime.attach(fake.paseo as never);
  return { dir, store, runtime, ...fake };
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function errorsOf(files: Record<string, string>, id: string): Promise<string> {
  const { dir } = await setup(files);
  return ((await loadPlaybooks(dir)).entries.find((entry) => entry.id === id)?.errors ?? []).join("\n");
}


const now = () => new Date().toISOString();

/** The running train of a station, once it has started. */
function trainAt(store: RunStore, station: string) {
  return store.list().find((run) => run.train?.station === station && (run.status === "running" || run.status === "waiting_gate"));
}

/** The station's gate decides its train: approve passes its jobs on, reject fails the train. */
async function decide(runtime: Runtime, store: RunStore, station: string, decision: "approved" | "rejected") {
  const train = trainAt(store, station)!;
  await runtime.requestGate(train.managerAgentId, train.id, station, "ok?", "");
  await runtime.decideGate(train.id, station, { decision, comment: null, by: null, via: "panel", now: now() });
  return train;
}

function pipelineOf(store: RunStore) {
  return store.list().find((run) => run.playbook.singleton && run.train === null)!;
}

describe("singleton pipelines: validation", () => {
  it("load stations from the top-level steps, and the hand-off's contract from the singleton", async () => {
    const { dir } = await setup();
    const entries = (await loadPlaybooks(dir)).entries;
    const apply = entries.find((entry) => entry.id === "apply")!;
    const pr = entries.find((entry) => entry.id === "pr")!;
    expect(apply.errors).toEqual([]);
    expect(pr.errors).toEqual([]);
    expect(apply.playbook!.singleton).toEqual({
      branch: "main",
      stations: [
        { id: "dev", title: "Dev", needs: [], mode: "merge", retries: 1, steps: ["dev"] },
        { id: "prd", title: "Prd", needs: ["dev"], mode: "fifo", retries: 0, steps: ["prd"] },
      ],
    });
    expect(pr.playbook!.steps[0]).toMatchObject({ kind: "handoff", handoff: "apply", outcomes: ["done", "rejected", "failure"] });
  });

  it("expand a sub-playbook station, with its constant inputs reaching `when` inside it", async () => {
    const { dir } = await setup({
      "train.yaml": `
title: Train
hidden: true
inputs:
  env: { type: enum, values: [dev, prd], required: true }
steps:
  - id: go
    when: { env: prd }
    gate: { question: Go? }
  - id: check
    needs: [go]
    gate: { question: Checked? }
`,
      "trains.yaml": `
title: Trains
singleton: {}
inputs:
  pr_url: { type: string, required: true }
steps:
  - id: dev
    playbook: { name: train }
    inputs: { env: dev }
  - id: prd
    needs: [dev]
    playbook: { name: train }
    inputs: { env: prd }
`,
    });
    const trains = (await loadPlaybooks(dir)).entries.find((entry) => entry.id === "trains")!;
    expect(trains.errors).toEqual([]);
    expect(trains.playbook!.singleton!.stations.map((station) => [station.id, station.steps])).toEqual([
      ["dev", ["dev.go", "dev.check"]],
      ["prd", ["prd.go", "prd.check"]],
    ]);
    expect(trains.playbook!.steps.find((step) => step.id === "prd.go")!.when).toEqual([{ input: "env", source: "prd", values: ["prd"] }]);
  });

  it("refuse the v0.30.0 concurrency, `queue` outside a singleton, an editing role, a goto between stations, and `after`", async () => {
    const old = await errorsOf({ "apply.yaml": "title: A\nsingleton: { concurrency: { key: [env] } }\nsteps:\n  - id: a\n    gate: { question: ok }\n" }, "apply");
    expect(old).toMatch(/singleton.concurrency was removed: each top-level step is a station/);
    const queue = await errorsOf({ "w.yaml": "title: W\nsteps:\n  - id: a\n    gate: { question: ok }\n    queue: { mode: merge }\n" }, "w");
    expect(queue).toMatch(/`queue` only applies to a step of a singleton playbook/);
    const editing = await errorsOf({ "s.yaml": "title: S\nsingleton: {}\nsteps:\n  - id: a\n    role: { name: implementer }\n" }, "s");
    expect(editing).toMatch(/role "implementer" is not readonly; a singleton's trains share one workspace/);
    const back = await errorsOf(
      { "s.yaml": "title: S\nsingleton: {}\nsteps:\n  - id: a\n    gate: { question: ok }\n  - id: b\n    needs: [a]\n    gate: { question: ok, choices: { ok: ~, again: ~ } }\n    on: { again: { goto: a } }\n" },
      "s",
    );
    expect(back).toMatch(/goto "a" leaves station "b"; jobs only move forward/);
    const after = await errorsOf({ "s.yaml": "title: S\nsingleton: {}\nsteps:\n  - id: a\n    gate: { question: ok }\nafter:\n  - id: r\n    gate: { question: ok }\n" }, "s");
    expect(after).toMatch(/`after` does not apply to a singleton playbook/);
    const across = await errorsOf(
      { "s.yaml": "title: S\nsingleton: {}\nsteps:\n  - id: a\n    role: { name: reviewer }\n    outputs: { tag: {} }\n  - id: b\n    needs: [a]\n    role: { name: reviewer }\n    inputs: [tag]\n" },
      "s",
    );
    expect(across).toMatch(/reads step "a" of another station/);
  });

  it("refuse reading a job's input from a step, `when` on it, a hand-off to a non-singleton, a singleton sub-playbook, and a loop of hand-offs", async () => {
    const reading = await errorsOf({ "s.yaml": "title: S\nsingleton: {}\ninputs:\n  pr_url: { type: string }\nsteps:\n  - id: a\n    role: { name: reviewer }\n    inputs: [pr_url]\n" }, "s");
    expect(reading).toMatch(/inputs.pr_url: "pr_url" is each job's input/);
    const when = await errorsOf({ "s.yaml": "title: S\nsingleton: {}\ninputs:\n  env: { type: string }\nsteps:\n  - id: a\n    gate: { question: ok }\n    when: { env: dev }\n" }, "s");
    expect(when).toMatch(/when.env: a singleton's inputs are each job's/);
    const plain = await errorsOf({ "plain.yaml": "title: Plain\nsteps:\n  - id: a\n    gate: { question: ok }\n", "pr.yaml": "title: PR\nsteps:\n  - id: h\n    handoff: { name: plain }\n" }, "pr");
    expect(plain).toMatch(/handoff: playbook "plain" is not a singleton/);
    const sub = await errorsOf({ "apply.yaml": APPLY, "outer.yaml": "title: Outer\nsteps:\n  - id: s\n    playbook: { name: apply }\n" }, "outer");
    expect(sub).toMatch(/playbook "apply" is a singleton: .* cannot be a sub-playbook; use `handoff: \{ name: apply \}`/);
    const loop = await errorsOf(
      { "a.yaml": "title: A\nsingleton: {}\nsteps:\n  - id: h\n    handoff: { name: b }\n", "b.yaml": "title: B\nsingleton: {}\nsteps:\n  - id: h\n    handoff: { name: a }\n" },
      "a",
    );
    expect(loop).toMatch(/leads back to this playbook/);
    expect(await errorsOf({ "a.yaml": "title: A\nsingleton: true\nsteps:\n  - id: g\n    gate: { question: ok }\n" }, "a")).toMatch(/singleton: a feature is a block/);
  });
});

describe("singleton pipelines: jobs through the stations", () => {
  it("create the pipeline and its workspace once, run each station's train, and deliver the job's result", async () => {
    const { store, runtime, created, sent } = await setup();
    const pr = await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "https://x/pull/1" });
    await until(() => trainAt(store, "dev") !== undefined);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ title: "Apply", source: { kind: "worktree", action: "branch-off", refName: "main" } });
    const dev = trainAt(store, "dev")!;
    expect(dev.jobs.map((job) => job.inputs.pr_url)).toEqual(["https://x/pull/1"]);
    expect(dev.workspaceId).toBe(pipelineOf(store).workspaceId);
    expect(sent.find((entry) => entry.agentId === dev.managerAgentId)!.text).toMatch(/train of station "dev"/);
    // Outputs set on dev, read later; the job goes on.
    await runtime.settleJob(dev.managerAgentId, dev.id, dev.jobs[0]!.id, { summary: "", outputs: { report: "dev ok" } });
    await decide(runtime, store, "dev", "approved");
    await until(() => trainAt(store, "prd") !== undefined);
    expect(trainAt(store, "prd")!.jobs[0]!.outputs).toEqual({ report: "dev ok" });
    expect(store.get(pr.id)!.steps.apply!.attempts.at(-1)!.lastMessage).toMatch(/On the "prd" train/);
    await decide(runtime, store, "prd", "approved");
    await until(() => store.get(pr.id)!.status === "completed");
    expect(store.get(pr.id)!.steps.apply!.outputs).toEqual({ report: "dev ok" });
    expect(created).toHaveLength(1);
  });

  it("merge: jobs that piled up ride the next train together; fifo: one at a time", async () => {
    const { store, runtime } = await setup();
    await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "1" });
    await until(() => trainAt(store, "dev") !== undefined);
    await runtime.startPlaybook({ id: "m2", workspaceId: "ws2", cwd: "/" }, "pr", { pr_url: "2" });
    await runtime.startPlaybook({ id: "m3", workspaceId: "ws3", cwd: "/" }, "pr", { pr_url: "3" });
    const first = await decide(runtime, store, "dev", "approved");
    await until(() => trainAt(store, "dev") !== undefined && trainAt(store, "dev")!.id !== first.id);
    expect(trainAt(store, "dev")!.jobs.map((job) => job.inputs.pr_url)).toEqual(["2", "3"]);
    // prd is fifo: job 1 alone, then the others one by one.
    await until(() => trainAt(store, "prd") !== undefined);
    expect(trainAt(store, "prd")!.jobs.map((job) => job.inputs.pr_url)).toEqual(["1"]);
  });

  it("keep one manager per station: the previous train's is archived when the next leaves", async () => {
    const { store, runtime, archived } = await setup();
    await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "1" });
    await until(() => trainAt(store, "dev") !== undefined);
    await runtime.startPlaybook({ id: "m2", workspaceId: "ws2", cwd: "/" }, "pr", { pr_url: "2" });
    const first = await decide(runtime, store, "dev", "approved");
    await until(() => trainAt(store, "dev") !== undefined && trainAt(store, "dev")!.id !== first.id);
    expect(archived).toContain(first.managerAgentId);
  });

  it("tell the handing-off run when its train waits for a human, and when that is decided", async () => {
    const { store, runtime, sent } = await setup();
    const pr = await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "1" });
    await until(() => trainAt(store, "dev") !== undefined);
    const dev = trainAt(store, "dev")!;
    await runtime.requestGate(dev.managerAgentId, dev.id, "dev", "Applied?", "");
    await until(() => sent.some((entry) => entry.agentId === "m1" && /waits for a human at gate dev/.test(entry.text)));
    expect(sent.find((entry) => entry.agentId === "m1" && /waits for a human/.test(entry.text))!.text).toMatch(/Playbooks panel \(the "Apply" card\), not with resume/);
    expect(store.get(pr.id)!.steps.apply!.attempts.at(-1)!.lastMessage).toMatch(/Waiting for a human at dev/);
    await runtime.onManagerTurnEnded("m1");
    await runtime.decideGate(dev.id, "dev", { decision: "approved", comment: "ship it", by: "louis", via: "panel", now: now() });
    await until(() => sent.some((entry) => entry.agentId === "m1" && /dev of the "dev" train .* was decided: approved by louis: "ship it"/.test(entry.text)));
    // Announced once: later ticks do not repeat it.
    await until(() => trainAt(store, "prd") !== undefined);
    expect(sent.filter((entry) => entry.agentId === "m1" && /waits for a human at gate dev/.test(entry.text))).toHaveLength(1);
  });

  it("end a job early with an outcome: its run is told at once, the train goes on", async () => {
    const { store, runtime } = await setup();
    const pr = await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "1" });
    await until(() => trainAt(store, "dev") !== undefined);
    const dev = trainAt(store, "dev")!;
    await expect(runtime.settleJob(dev.managerAgentId, dev.id, dev.jobs[0]!.id, { outcome: "maybe", summary: "", outputs: {} })).rejects.toThrow(/not an outcome of "apply"/);
    await expect(runtime.settleJob(dev.managerAgentId, dev.id, dev.jobs[0]!.id, { outcome: "done", summary: "", outputs: {} })).rejects.toThrow(/missing output "report"/);
    await runtime.settleJob(dev.managerAgentId, dev.id, dev.jobs[0]!.id, { outcome: "rejected", summary: "broke dev", outputs: {} });
    expect(store.get(pr.id)!.status).toBe("failed");
    expect(store.get(dev.id)!.status).toBe("running");
  });

  it("put a failed train's jobs back at the front of its station, within its retries, then fail them", async () => {
    const { store, runtime } = await setup();
    const pr = await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "1" });
    await until(() => trainAt(store, "dev") !== undefined);
    const first = await decide(runtime, store, "dev", "rejected");
    await until(() => trainAt(store, "dev") !== undefined && trainAt(store, "dev")!.id !== first.id);
    expect(pipelineOf(store).jobs[0]!.failedRides).toEqual({ dev: 1 });
    await decide(runtime, store, "dev", "rejected");
    await until(() => store.get(pr.id)!.status === "failed");
    expect(pipelineOf(store).jobs[0]).toMatchObject({ status: "failed" });
  });

  it("hold a result while the handing-off run is paused, and complete it on resume", async () => {
    const { store, runtime } = await setup();
    const pr = await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "1" });
    await until(() => trainAt(store, "dev") !== undefined);
    await runtime.pauseRun(pr.id);
    const dev = trainAt(store, "dev")!;
    await runtime.settleJob(dev.managerAgentId, dev.id, dev.jobs[0]!.id, { outcome: "done", summary: "", outputs: { report: "ok" } });
    expect(store.get(pr.id)!.steps.apply!.status).toBe("reported");
    await runtime.resumeRun(pr.id);
    expect(store.get(pr.id)!.status).toBe("completed");
  });

  it("withdraw a job when its run is canceled: it leaves the waiting list, and its train is told", async () => {
    const { store, runtime, sent } = await setup();
    const one = await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "1" });
    await until(() => trainAt(store, "dev") !== undefined);
    const two = await runtime.startPlaybook({ id: "m2", workspaceId: "ws2", cwd: "/" }, "pr", { pr_url: "2" });
    await runtime.cancelRun(two.id, "not needed", null);
    expect(pipelineOf(store).jobs.find((job) => job.inputs.pr_url === "2")).toMatchObject({ status: "withdrawn", waiting: [] });
    await runtime.cancelRun(one.id, "not needed", null);
    // Its manager is busy (it was just started): the note waits in the train's inbox.
    const dev = trainAt(store, "dev")!;
    expect([...store.get(dev.id)!.inbox, ...sent.filter((entry) => entry.agentId === dev.managerAgentId).map((entry) => entry.text)].some((text) => /was withdrawn/.test(text))).toBe(true);
  });

  it("fail the open jobs and cancel the trains when the pipeline is canceled", async () => {
    const { store, runtime } = await setup();
    const pr = await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "1" });
    await until(() => trainAt(store, "dev") !== undefined);
    const dev = trainAt(store, "dev")!;
    await runtime.cancelRun(pipelineOf(store).id, "stop", null);
    await until(() => store.get(pr.id)!.status === "failed");
    expect(store.get(dev.id)!.status).toBe("canceled");
  });

  it("time out a hand-off: its job is withdrawn and the step fails", async () => {
    const { store, runtime } = await setup({ "apply.yaml": APPLY, "pr.yaml": PR.replace("    on:", "    timeout: 1s\n    on:") });
    const pr = await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "1" });
    await until(() => store.get(pr.id)!.status === "failed", 4000);
    expect(pipelineOf(store).jobs[0]!.status).toBe("withdrawn");
  });

  it("start a singleton by hand: its pipeline and workspace exist, with no train", async () => {
    const { store, runtime, created } = await setup();
    const run = await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "apply", {});
    expect(created).toHaveLength(1);
    expect(run).toMatchObject({ status: "running", managerAgentId: "", jobs: [] });
    expect(store.list().filter((candidate) => candidate.train)).toHaveLength(0);
  });
});
