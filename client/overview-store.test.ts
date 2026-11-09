import { describe, expect, it } from "vitest";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createOverviewStore } from "./overview-store";

/** A client whose RPCs resolve when the test says so, and whose agent list never emits. */
function fakeClient() {
  const calls: Array<{ name: string; input: unknown; resolve(value: unknown): void }> = [];
  const client = {
    paseo: { agents: { list: () => new Promise(() => undefined) } },
    rpc: (contract: { name: string }, input: unknown) => new Promise((resolve) => calls.push({ name: contract.name, input, resolve })),
  } as unknown as PluginClientContext;
  return { client, calls };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const run = (pending: number) => ({ id: `r${pending}`, gates: Array.from({ length: pending }, () => ({ stepId: "s" })) });

describe("overview store", () => {
  it("fetches only the count while no screen is open, and nothing before anything subscribes", async () => {
    const { client, calls } = fakeClient();
    const store = createOverviewStore(client);
    store.refresh();
    expect(calls).toHaveLength(0);
    const release = store.subscribe(() => undefined);
    expect(calls.map((call) => call.name)).toEqual(["overview.needs-you"]);
    calls[0]!.resolve({ count: 3 });
    await tick();
    expect(store.get()).toEqual({ count: 3, runs: null, error: null });
    release();
    store.refresh();
    expect(calls).toHaveLength(1);
  });

  it("fetches runs while a screen is open, counts their gates, and merges refreshes in flight", async () => {
    const { client, calls } = fakeClient();
    const store = createOverviewStore(client);
    store.subscribe(() => undefined);
    const closeScreen = store.watchRuns();
    store.refresh();
    store.refresh();
    // The count request was in flight: one more request follows it, with runs.
    expect(calls.map((call) => call.name)).toEqual(["overview.needs-you"]);
    calls[0]!.resolve({ count: 0 });
    await tick();
    expect(calls.map((call) => call.name)).toEqual(["overview.needs-you", "overview.state"]);
    calls[1]!.resolve({ version: "v1", runs: [run(2), run(1)] });
    await tick();
    expect(store.get().count).toBe(3);
    expect(store.get().runs).toHaveLength(2);
    closeScreen();
    expect(store.get().runs).toBeNull();
    store.refresh();
    expect(calls[2]!.name).toBe("overview.needs-you");
  });

  it("sends the version it holds, and keeps its runs when the server says nothing changed", async () => {
    const { client, calls } = fakeClient();
    const store = createOverviewStore(client);
    store.subscribe(() => undefined);
    store.watchRuns();
    calls[0]!.resolve({ count: 0 });
    await tick();
    expect(calls[1]!.input).toEqual({ since: null });
    calls[1]!.resolve({ version: "v1", runs: [run(2)] });
    await tick();
    store.refresh();
    expect(calls[2]!.input).toEqual({ since: "v1" });
    calls[2]!.resolve({ version: "v1", runs: null });
    await tick();
    expect(store.get().runs).toHaveLength(1);
    expect(store.get().count).toBe(2);
    store.refresh();
    calls[3]!.resolve({ version: "v2", runs: [run(1)] });
    await tick();
    expect(store.get().count).toBe(1);
  });
});
