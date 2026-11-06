import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Runtime, runName } from "./runtime";
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
  const dir = await mkdtemp(path.join(tmpdir(), "name-"));
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

describe("run names", () => {
  it("keep the manager's name on one line, cut to fit a tab", () => {
    expect(runName("  login\n redirect   fix ")).toBe("login redirect fix");
    expect(runName("x".repeat(50))).toBe("x".repeat(32));
    expect(runName("   ")).toBeNull();
    expect(runName(undefined)).toBeNull();
  });

  it("are stored on the run start_playbook creates", async () => {
    const { store, runtime } = await setup({ "w.yaml": "title: W\nsteps:\n  - id: go\n    gate: { question: Go? }\n" });
    const named = await runtime.startPlaybook({ id: "m", workspaceId: "ws", cwd: "/" }, "w", {}, { name: "login-redirect-fix" });
    expect(store.get(named.id)!.name).toBe("login-redirect-fix");
  });
});
