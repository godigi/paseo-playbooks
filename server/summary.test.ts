import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunSchema, RunSummarySchema, isActive, isPaused, isPipeline } from "../shared/types";
import { summarizeRun } from "../shared/summary";
import { newRun } from "./engine";
import { loadPlaybooks } from "./loader";

const EXAMPLES = path.resolve(__dirname, "..", "examples");
const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRun() {
  const dir = await mkdtemp(path.join(tmpdir(), "summary-"));
  temps.push(dir);
  const root = path.join(dir, ".paseo/playbooks");
  await mkdir(root, { recursive: true });
  await cp(path.join(EXAMPLES, ".paseo/plugins/playbooks/roles"), path.join(root, "roles"), { recursive: true });
  await writeFile(
    path.join(root, "release.yaml"),
    `title: Release\ninputs:\n  request: { type: string }\nsteps:\n  - id: a\n    role: { name: implementer }\n  - id: b\n    role: { name: implementer }\n    needs: [a]\n`,
  );
  const playbook = (await loadPlaybooks(dir)).entries.find((entry) => entry.id === "release")!.playbook!;
  return newRun({ id: "run_x", playbook, workspaceId: "ws", workspaceDir: dir, projectId: "p", branch: null, managerAgentId: "m", inputs: { request: "  Fix the login\nmore detail" }, now: "2026-11-09T00:00:00.000Z" });
}

describe("summarizeRun", () => {
  it("keeps what the overview draws and drops what makes a run heavy", async () => {
    const run = RunSchema.parse(await makeRun());
    run.history.push({ seq: 1, at: run.createdAt, type: "x", stepId: null, detail: "d".repeat(50_000) });
    run.gates.push({
      ...RunSchema.shape.gates.element.parse({
        id: "g1", kind: "gate", stepId: "a", gotoTarget: null, status: "pending", message: "Approve?\n\nLong details", requestedAt: run.createdAt,
        comment: null, decidedBy: null, decidedVia: null, decidedAt: null,
      }),
    });
    const summary = summarizeRun(run);
    expect(RunSummarySchema.parse(summary)).toEqual(summary);
    expect(summary.inputTitle).toBe("Fix the login");
    expect(summary.playbook.steps.map((step) => step.id)).toEqual(["a", "b"]);
    expect(summary.gates).toEqual([{ id: "g1", kind: "gate", stepId: "a", requestedAt: run.createdAt, summary: "Approve?" }]);
    expect(Object.keys(summary.steps)).toEqual(["a", "b"]);
    expect(JSON.stringify(summary).length).toBeLessThan(JSON.stringify(run).length / 5);
    expect(isActive(summary)).toBe(isActive(run));
    expect(isPaused(summary)).toBe(isPaused(run));
    expect(isPipeline(summary)).toBe(isPipeline(run));
  });

  it("leaves decided gates out", async () => {
    const run = RunSchema.parse(await makeRun());
    run.gates.push(
      RunSchema.shape.gates.element.parse({
        id: "g1", kind: "gate", stepId: "a", gotoTarget: null, status: "approved", message: "m", requestedAt: run.createdAt,
        comment: null, decidedBy: "x", decidedVia: "panel", decidedAt: run.createdAt,
      }),
    );
    expect(summarizeRun(run).gates).toEqual([]);
  });
});
