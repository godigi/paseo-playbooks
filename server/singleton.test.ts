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
  let agents = 0;
  const ref = (agentId: string) => ({
    refresh: async () => ({ agent: { id: agentId, status: "idle", provider: "claude", model: null, archivedAt: null, pendingPermissions: [] } }),
    send: async (text: string) => void sent.push({ agentId, text }),
    reload: async () => undefined,
    archive: async () => undefined,
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
  return { paseo, sent, created };
}

const APPLY = `
title: Apply
singleton:
  branch: main
  concurrency:
    key: [env]
    limit: 1
inputs:
  env: { type: enum, values: [dev, prd], required: true }
  pr_url: { type: string, required: true }
outputs:
  report: { type: string }
outcomes: [done, rejected]
steps:
  - id: go
    when: { env: prd }
    gate: { question: Apply to prd? }
  - id: confirm
    needs: [go]
    gate: { question: Applied? }
`;

const PR = `
title: PR
inputs:
  pr_url: { type: string, required: true }
steps:
  - id: apply_dev
    handoff: { name: apply }
    inputs: { env: dev, pr_url: ~ }
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

describe("singleton playbooks and hand-off steps: validation", () => {
  it("load: key and limit, the hand-off's contract is the target's (plus failure)", async () => {
    const { dir } = await setup();
    const entries = (await loadPlaybooks(dir)).entries;
    const apply = entries.find((entry) => entry.id === "apply")!;
    const pr = entries.find((entry) => entry.id === "pr")!;
    expect(apply.errors).toEqual([]);
    expect(pr.errors).toEqual([]);
    expect(apply.playbook!.singleton).toEqual({ branch: "main", key: ["env"], limit: 1 });
    expect(apply.playbook!.steps[0]!.when).toEqual([{ input: "env", source: "{{ playbook.inputs.env }}", values: ["prd"] }]);
    const step = pr.playbook!.steps[0]!;
    expect(step).toMatchObject({ kind: "handoff", handoff: "apply", outcomes: ["done", "rejected", "failure"], outputs: { report: { type: "string" } } });
    expect(Object.keys(step.inputs).sort()).toEqual(["env", "pr_url"]);
  });

  it("refuse a top-level concurrency, an unknown key, and a step reading a job's input", async () => {
    const errors = await errorsOf(
      {
        "apply.yaml": `
title: Apply
singleton: { concurrency: { key: [env, nope] } }
concurrency: 1
inputs:
  env: { type: string, required: true }
  pr_url: { type: string, required: true }
steps:
  - id: a
    gate: { question: ok }
  - id: b
    needs: [a]
    role: { name: reviewer }
    inputs: [pr_url]
`,
      },
      "apply",
    );
    expect(errors).toMatch(/`concurrency` does not apply to a singleton playbook/);
    expect(errors).toMatch(/singleton.concurrency.key: "nope" is not an input/);
  });

  it("refuse reading a job's input from a step, and `when` on a job's input", async () => {
    const errors = await errorsOf(
      {
        "apply.yaml": `
title: Apply
singleton: { concurrency: { key: [env] } }
inputs:
  env: { type: string, required: true }
  pr_url: { type: string, required: true }
steps:
  - id: b
    role: { name: reviewer }
    when: { pr_url: x }
`,
      },
      "apply",
    );
    expect(errors).toMatch(/when.pr_url: on a singleton playbook, `when` may only use the run's inputs/);
    const reading = await errorsOf(
      {
        "apply.yaml": `
title: Apply
singleton: { concurrency: { key: [env] } }
inputs:
  env: { type: string, required: true }
  pr_url: { type: string, required: true }
steps:
  - id: b
    role: { name: reviewer }
    inputs: [env, pr_url]
`,
      },
      "apply",
    );
    expect(reading).toMatch(/inputs.pr_url: "pr_url" is each job's input/);
    expect(reading).not.toMatch(/inputs.env/);
  });

  it("refuse a hand-off to a playbook that is not a singleton, a singleton as a sub-playbook, and a hand-off leading back", async () => {
    const plain = await errorsOf(
      {
        "plain.yaml": "title: Plain\nsteps:\n  - id: a\n    gate: { question: ok }\n",
        "pr.yaml": "title: PR\nsteps:\n  - id: h\n    handoff: { name: plain }\n",
      },
      "pr",
    );
    expect(plain).toMatch(/handoff: playbook "plain" is not a singleton/);
    const sub = await errorsOf({ "apply.yaml": APPLY, "outer.yaml": "title: Outer\nsteps:\n  - id: s\n    playbook: { name: apply }\n" }, "outer");
    expect(sub).toMatch(/playbook "apply" is a singleton: .* cannot be a sub-playbook; use `handoff: { name: apply }`/);
    const loop = await errorsOf(
      {
        "a.yaml": "title: A\nsingleton: {}\nsteps:\n  - id: h\n    handoff: { name: b }\n",
        "b.yaml": "title: B\nsingleton: {}\nsteps:\n  - id: h\n    handoff: { name: a }\n",
      },
      "a",
    );
    expect(loop).toMatch(/leads back to this playbook/);
    const flat = await errorsOf(
      {
        "a.yaml": "title: A\nsingleton: true\nsteps:\n  - id: g\n    gate: { question: ok }\n",
        "b.yaml": "title: B\nsteps:\n  - id: h\n    handoff: a\n",
      },
      "b",
    );
    expect(flat).toMatch(/handoff: write `handoff: \{ name: a \}`/);
    expect(await errorsOf({ "a.yaml": "title: A\nsingleton: true\nsteps:\n  - id: g\n    gate: { question: ok }\n" }, "a")).toMatch(/singleton: a feature is a block: write `singleton: \{\}`/);
  });

  it("refuse a `when` value that does not fit, and reading outputs of a conditional step", async () => {
    const errors = await errorsOf(
      {
        "w.yaml": `
title: W
inputs:
  env: { type: enum, values: [dev, prd], required: true }
steps:
  - id: a
    role: { name: reviewer }
    when: { env: [dev, stg] }
    outputs: { url: {} }
  - id: c
    role: { name: reviewer }
    when: { env: dev }
    outputs: { other: {} }
  - id: b
    needs: [a]
    role: { name: reviewer }
    inputs: [url]
`,
      },
      "w",
    );
    expect(errors).toMatch(/when.env: "stg": expected one of dev, prd/);
    const reading = await errorsOf(
      {
        "w.yaml": `
title: W
inputs:
  env: { type: enum, values: [dev, prd], required: true }
steps:
  - id: a
    role: { name: reviewer }
    when: { env: dev }
    outputs: { url: {} }
  - id: b
    needs: [a]
    role: { name: reviewer }
    inputs: [url]
  - id: c
    needs: [a]
    role: { name: reviewer }
    when: { env: dev }
    inputs: [url]
`,
      },
      "w",
    );
    expect(reading).toMatch(/step "b": input "url" matches an output of step "a", which has a `when`/);
    expect(reading).not.toMatch(/step "c"/);
  });
});

describe("conditional steps", () => {
  it("skip a step whose `when` does not hold; the steps after it go on", async () => {
    const { store, runtime } = await setup({
      "w.yaml": `
title: W
inputs:
  env: { type: enum, values: [dev, prd], required: true }
steps:
  - id: go
    when: { env: prd }
    gate: { question: Go? }
  - id: done
    needs: [go]
    gate: { question: Done? }
`,
    });
    const dev = await runtime.startPlaybook({ id: "m", workspaceId: "ws", cwd: "/" }, "w", { env: "dev" });
    expect(store.get(dev.id)!.steps.go!.status).toBe("skipped");
    expect(store.get(dev.id)!.steps.done!.status).toBe("ready");
    expect(store.get(dev.id)!.history.some((event) => event.type === "step_skipped" && event.detail === "when: env is dev, not prd")).toBe(true);
  });
});

describe("conditional sub-playbook steps", () => {
  it("apply a playbook step's `when` to every step of the block, read through the parent's wiring", async () => {
    const { dir } = await setup({
      "inner.yaml": `
title: Inner
hidden: true
inputs:
  env: { type: string, required: true }
steps:
  - id: go
    when: { env: prd }
    gate: { question: Go? }
  - id: work
    needs: [go]
    gate: { question: Done? }
`,
      "outer.yaml": `
title: Outer
inputs:
  target: { type: enum, values: [dev, prd], required: true }
  fast: { type: boolean, default: false }
steps:
  - id: block
    playbook: { name: inner }
    when: { fast: false }
    inputs: { env: "{{ playbook.inputs.target }}" }
`,
    });
    const outer = (await loadPlaybooks(dir)).entries.find((entry) => entry.id === "outer")!;
    expect(outer.errors).toEqual([]);
    const go = outer.playbook!.steps.find((step) => step.id === "block.go")!;
    expect(go.when).toEqual([
      { input: "fast", source: "{{ playbook.inputs.fast }}", values: ["false"] },
      { input: "env", source: "{{ playbook.inputs.target }}", values: ["prd"] },
    ]);
    expect(outer.playbook!.steps.find((step) => step.id === "block.work")!.when).toEqual([{ input: "fast", source: "{{ playbook.inputs.fast }}", values: ["false"] }]);
  });
});

describe("hand-offs to a singleton", () => {
  it("board a job, depart with its own worktree and manager, and deliver the settled result", async () => {
    const { store, runtime, sent, created } = await setup();
    const pr = await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "https://x/pull/1" });
    await until(() => created.length === 1);
    const carrier = store.list().find((run) => run.playbook.id === "apply")!;
    await until(() => store.get(carrier.id)!.status !== "boarding");
    const departed = store.get(carrier.id)!;
    expect(created[0]).toMatchObject({ source: { kind: "worktree", action: "branch-off", refName: "main" } });
    expect(departed).toMatchObject({ status: "running", inputs: { env: "dev" }, managerAgentId: "mgr1" });
    expect(departed.jobs).toHaveLength(1);
    expect(departed.jobs[0]).toMatchObject({ fromRunId: pr.id, fromStepId: "apply_dev", inputs: { pr_url: "https://x/pull/1" }, status: "open" });
    // On dev the prd-only gate is skipped; the manager is told about its jobs.
    expect(departed.steps.go!.status).toBe("skipped");
    expect(sent.find((entry) => entry.agentId === "mgr1")!.text).toMatch(/pr_url: https:\/\/x\/pull\/1/);
    expect(store.get(pr.id)!.steps.apply_dev!.status).toBe("running");

    await runtime.settleJob("mgr1", carrier.id, departed.jobs[0]!.id, { outcome: "done", summary: "applied", outputs: { report: "ok" } });
    expect(store.get(pr.id)!.status).toBe("completed");
    expect(store.get(pr.id)!.steps.apply_dev!.outputs).toEqual({ report: "ok" });
  });

  it("wait in the boarding run while the key's slot is taken, then depart together", async () => {
    const { store, runtime, created } = await setup();
    await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "https://x/pull/1" });
    await until(() => created.length === 1);
    const first = store.list().find((run) => run.playbook.id === "apply")!;
    await runtime.startPlaybook({ id: "m2", workspaceId: "ws2", cwd: "/" }, "pr", { pr_url: "https://x/pull/2" });
    await runtime.startPlaybook({ id: "m3", workspaceId: "ws3", cwd: "/" }, "pr", { pr_url: "https://x/pull/3" });
    const boarding = store.list().filter((run) => run.status === "boarding");
    expect(boarding).toHaveLength(1);
    expect(boarding[0]!.jobs.map((job) => job.inputs.pr_url)).toEqual(["https://x/pull/2", "https://x/pull/3"]);
    // The first run ends: its open job takes the run's outcome, and the waiting list departs.
    await until(() => store.get(first.id)!.status === "running");
    await runtime.requestGate("mgr1", first.id, "confirm", "Applied?", "");
    await runtime.decideGate(first.id, "confirm", { decision: "approved", comment: null, by: null, via: "panel", now: new Date().toISOString() });
    await until(() => created.length === 2);
    expect(store.get(first.id)!.jobs[0]).toMatchObject({ status: "settled", outcome: "done" });
    await until(() => store.get(boarding[0]!.id)!.status === "running");
  });

  it("refuse settling a job with an unknown outcome or without the first outcome's outputs", async () => {
    const { store, runtime, created } = await setup();
    await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "https://x/pull/1" });
    await until(() => created.length === 1);
    const carrier = store.list().find((run) => run.playbook.id === "apply")!;
    await until(() => store.get(carrier.id)!.status === "running");
    const jobId = store.get(carrier.id)!.jobs[0]!.id;
    await expect(runtime.settleJob("mgr1", carrier.id, jobId, { outcome: "maybe", summary: "", outputs: {} })).rejects.toThrow(/not an outcome of "apply"/);
    await expect(runtime.settleJob("mgr1", carrier.id, jobId, { outcome: "done", summary: "", outputs: {} })).rejects.toThrow(/missing output "report"/);
    await runtime.settleJob("mgr1", carrier.id, jobId, { outcome: "rejected", summary: "broke dev", outputs: {} });
    expect(store.get(carrier.id)!.jobs[0]).toMatchObject({ status: "settled", outcome: "rejected" });
  });

  it("hold a settled result while the handing-off run is paused, and complete it on resume", async () => {
    const { store, runtime, created } = await setup();
    const pr = await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "https://x/pull/1" });
    await until(() => created.length === 1);
    const carrier = store.list().find((run) => run.playbook.id === "apply")!;
    await until(() => store.get(carrier.id)!.status === "running");
    await runtime.pauseRun(pr.id);
    await runtime.settleJob("mgr1", carrier.id, store.get(carrier.id)!.jobs[0]!.id, { outcome: "done", summary: "applied", outputs: { report: "ok" } });
    expect(store.get(pr.id)!.steps.apply_dev!.status).toBe("reported");
    await runtime.resumeRun(pr.id);
    expect(store.get(pr.id)!.status).toBe("completed");
  });

  it("start a singleton by hand: its boarding run departs without a job", async () => {
    const { store, runtime, created } = await setup();
    const run = await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "apply", { env: "prd" });
    await until(() => created.length === 1);
    await until(() => store.get(run.id)!.status !== "boarding");
    expect(store.get(run.id)!).toMatchObject({ inputs: { env: "prd" }, jobs: [] });
    // On prd the gate is not skipped.
    expect(store.get(run.id)!.steps.go!.status).toBe("ready");
  });

  it("time out a hand-off still waiting: its job is withdrawn and the step fails", async () => {
    const { store, runtime, created } = await setup({ "apply.yaml": APPLY, "pr.yaml": PR.replace("    on:", "    timeout: 1s\n    on:") });
    await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "https://x/pull/1" });
    await until(() => created.length === 1);
    const waiting = await runtime.startPlaybook({ id: "m2", workspaceId: "ws2", cwd: "/" }, "pr", { pr_url: "https://x/pull/2" });
    expect(store.list().some((run) => run.status === "boarding")).toBe(true);
    await until(() => store.get(waiting.id)!.status === "failed", 4000);
    expect(store.get(waiting.id)!.failure).toMatch(/apply_dev/);
    expect(store.list().some((run) => run.status === "boarding")).toBe(false);
  });

  it("withdraw a job when its run is canceled, dropping a boarding run left empty", async () => {
    const { store, runtime, created } = await setup();
    await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "https://x/pull/1" });
    await until(() => created.length === 1);
    const second = await runtime.startPlaybook({ id: "m2", workspaceId: "ws2", cwd: "/" }, "pr", { pr_url: "https://x/pull/2" });
    const boarding = store.list().find((run) => run.status === "boarding")!;
    await runtime.cancelRun(second.id, "not needed", null);
    expect(store.get(boarding.id)).toBeUndefined();
  });

  it("fail the hand-off steps of the jobs still open when the carrying run is canceled", async () => {
    const { store, runtime, created } = await setup();
    const pr = await runtime.startPlaybook({ id: "m1", workspaceId: "ws1", cwd: "/" }, "pr", { pr_url: "https://x/pull/1" });
    await until(() => created.length === 1);
    const carrier = store.list().find((run) => run.playbook.id === "apply")!;
    await until(() => store.get(carrier.id)!.status === "running");
    await runtime.cancelRun(carrier.id, "stop", null);
    expect(store.get(carrier.id)!.jobs[0]!.status).toBe("failed");
    expect(store.get(pr.id)!.status).toBe("failed");
  });
});
