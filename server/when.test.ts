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
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
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

async function setup(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), "when-"));
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

describe("conditional steps: validation", () => {
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

