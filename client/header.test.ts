import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeHeaderButtons } from "./header";

vi.mock("react-native", () => ({ View: () => null }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: () => null }));

type Handlers = {
  snapshot(message: { entries: Array<{ id: string }> }): void;
  update(message: { type: string; payload: { kind: string; workspace?: { id: string }; id?: string } }): void;
};

/** A client that records the workspace ids every header.state request carries, and answers them all as playbook-less. */
function fakeClient(withPlaybooks: (ids: string[]) => string[] = () => []) {
  const requests: string[][] = [];
  const updates: Array<{ id: string; visible?: boolean }> = [];
  let handlers!: Handlers;
  const client = {
    paseo: {
      workspaces: {
        list: () =>
          Promise.resolve({
            subscription: { subscribe: (h: Handlers) => ((handlers = h), () => undefined), release: () => undefined },
          }),
      },
    },
    addHeaderButton: ({ workspaceId }: { workspaceId: string }) => ({
      update: (patch: { visible?: boolean }) => updates.push({ id: workspaceId, ...patch }),
      remove: () => undefined,
    }),
    openPanel: () => undefined,
    rpc: (_contract: unknown, input: { workspaceIds: string[] }) => {
      requests.push(input.workspaceIds);
      return Promise.resolve({ withPlaybooks: withPlaybooks(input.workspaceIds), waiting: [] });
    },
  } as unknown as PluginClientContext;
  return { client, requests, updates, handlers: () => handlers };
}

const upsert = (id: string) => ({ type: "workspace_update", payload: { kind: "upsert", workspace: { id } } });

describe("header buttons", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks once for a whole burst of new workspaces, and only for them", async () => {
    const { client, requests, handlers } = fakeClient();
    const stop = contributeHeaderButtons(client);
    await vi.advanceTimersByTimeAsync(0);
    handlers().snapshot({ entries: [{ id: "a" }, { id: "b" }] });
    for (let n = 0; n < 200; n += 1) handlers().update(upsert(`w${n}`));
    await vi.advanceTimersByTimeAsync(400);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toHaveLength(202);
    // Upserts of workspaces already known (git and agent changes) cost nothing.
    for (let n = 0; n < 200; n += 1) handlers().update(upsert(`w${n}`));
    handlers().snapshot({ entries: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    await vi.advanceTimersByTimeAsync(400);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(["c"]);
    stop();
  });

  it("keeps one request in flight and follows it with one more", async () => {
    let release!: (value: unknown) => void;
    const { client, requests, handlers } = fakeClient();
    const rpc = client.rpc as unknown as (c: unknown, i: { workspaceIds: string[] }) => Promise<unknown>;
    let first = true;
    (client as unknown as { rpc: typeof rpc }).rpc = (c, input) => {
      requests.push(input.workspaceIds);
      if (!first) return Promise.resolve({ withPlaybooks: [], waiting: [] });
      first = false;
      return new Promise((resolve) => (release = resolve));
    };
    const stop = contributeHeaderButtons(client);
    await vi.advanceTimersByTimeAsync(0);
    handlers().update(upsert("a"));
    await vi.advanceTimersByTimeAsync(400);
    handlers().update(upsert("b"));
    handlers().update(upsert("c"));
    await vi.advanceTimersByTimeAsync(400);
    expect(requests).toEqual([["a"]]);
    release({ withPlaybooks: [], waiting: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toEqual([["a"], ["b", "c"]]);
    stop();
  });

  it("applies the answer to the queried workspaces", async () => {
    const { client, updates, handlers } = fakeClient((ids) => ids.filter((id) => id === "a"));
    const stop = contributeHeaderButtons(client);
    await vi.advanceTimersByTimeAsync(0);
    handlers().snapshot({ entries: [{ id: "a" }, { id: "b" }] });
    await vi.advanceTimersByTimeAsync(400);
    expect(updates).toEqual([expect.objectContaining({ id: "a", visible: true })]);
    stop();
  });

  it("polls every workspace, but not while the tab is in the background", async () => {
    const { client, requests, handlers } = fakeClient();
    let state = "visible";
    const listeners = new Set<() => void>();
    vi.stubGlobal("document", {
      get visibilityState() {
        return state;
      },
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    });
    const stop = contributeHeaderButtons(client);
    await vi.advanceTimersByTimeAsync(0);
    handlers().snapshot({ entries: [{ id: "a" }, { id: "b" }] });
    await vi.advanceTimersByTimeAsync(400);
    requests.length = 0;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(requests).toEqual([["a", "b"]]);
    state = "hidden";
    requests.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requests).toHaveLength(0);
    state = "visible";
    for (const listener of listeners) listener();
    await vi.advanceTimersByTimeAsync(400);
    expect(requests).toEqual([["a", "b"]]);
    stop();
  });

  it("keeps the pending question while the tab turns hidden, and sends it when the tab shows again", async () => {
    const { client, requests, handlers } = fakeClient();
    let state = "visible";
    const listeners = new Set<() => void>();
    vi.stubGlobal("document", {
      get visibilityState() {
        return state;
      },
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    });
    const stop = contributeHeaderButtons(client);
    await vi.advanceTimersByTimeAsync(0);
    handlers().snapshot({ entries: [{ id: "a" }] });
    state = "hidden";
    await vi.advanceTimersByTimeAsync(400);
    expect(requests).toHaveLength(0);
    state = "visible";
    for (const listener of listeners) listener();
    await vi.advanceTimersByTimeAsync(400);
    expect(requests).toEqual([["a"]]);
    stop();
  });

  it("ignores an answer about a workspace that was removed and added again meanwhile", async () => {
    const { client, updates, handlers } = fakeClient();
    const resolvers: Array<(value: unknown) => void> = [];
    (client as unknown as { rpc: unknown }).rpc = () => new Promise((resolve) => resolvers.push(resolve));
    const stop = contributeHeaderButtons(client);
    await vi.advanceTimersByTimeAsync(0);
    handlers().snapshot({ entries: [{ id: "a" }] });
    await vi.advanceTimersByTimeAsync(400);
    handlers().snapshot({ entries: [] });
    handlers().snapshot({ entries: [{ id: "a" }] });
    resolvers[0]!({ withPlaybooks: ["a"], waiting: ["a"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(updates).toEqual([]);
    await vi.advanceTimersByTimeAsync(400);
    resolvers[1]!({ withPlaybooks: ["a"], waiting: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(updates).toEqual([expect.objectContaining({ id: "a", visible: true })]);
    stop();
  });
});
