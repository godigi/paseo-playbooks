import { gateText } from "./gates";
import type { Run, RunSummary } from "./types";

const INPUT_TITLE_MAX = 200;

export function summarizeRun(run: Run): RunSummary {
  const text = Object.values(run.inputs).find((value): value is string => typeof value === "string" && value.trim() !== "");
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    managerAgentId: run.managerAgentId,
    name: run.name,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    seenAt: run.seenAt,
    pausedAt: run.pausedAt,
    inputTitle: text ? text.trim().split("\n")[0]!.slice(0, INPUT_TITLE_MAX) : null,
    playbook: {
      id: run.playbook.id,
      title: run.playbook.title,
      description: run.playbook.description,
      steps: run.playbook.steps.map((step) => ({
        id: step.id,
        ...(step.title !== undefined ? { title: step.title } : {}),
        ...(step.shortTitle !== undefined ? { shortTitle: step.shortTitle } : {}),
        ...(step.afterTask !== undefined ? { afterTask: step.afterTask } : {}),
        ...(step.when ? { conditional: true } : {}),
      })),
      stations: run.playbook.singleton ? run.playbook.singleton.stations : null,
    },
    steps: Object.fromEntries(Object.entries(run.steps).map(([id, step]) => [id, { status: step.status }])),
    after: Object.fromEntries(Object.entries(run.after).map(([id, task]) => [id, { status: task.status }])),
    gates: run.gates
      .filter((gate) => gate.status === "pending")
      .map((gate) => ({
        id: gate.id,
        kind: gate.kind,
        stepId: gate.stepId,
        requestedAt: gate.requestedAt,
        summary: gateText(gate).summary.split("\n")[0] ?? "",
      })),
    jobs: run.jobs.map((job) => ({ id: job.id, label: job.label, status: job.status, waiting: job.waiting })),
    train: run.train,
  };
}
