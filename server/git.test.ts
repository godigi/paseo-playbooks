import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { freshRef } from "./git";

const run = promisify(execFile);
const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]) {
  return (await run("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "init.defaultBranch=main", ...args], { cwd })).stdout.trim();
}

async function repo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "git-"));
  temps.push(dir);
  await git(dir, "init", "-q");
  await writeFile(path.join(dir, "a"), "1");
  await git(dir, "add", "a");
  await git(dir, "commit", "-qm", "one");
  return dir;
}

describe("freshRef", () => {
  it("branch off origin's copy, fetched, when the local branch is behind", async () => {
    const origin = await repo();
    const clone = await mkdtemp(path.join(tmpdir(), "git-"));
    temps.push(clone);
    await git(clone, "clone", "-q", origin, ".");
    await writeFile(path.join(origin, "b"), "2");
    await git(origin, "add", "b");
    await git(origin, "commit", "-qm", "two");
    expect(await freshRef(clone, "main")).toBe("origin/main");
    expect(await git(clone, "rev-parse", "origin/main")).toBe(await git(origin, "rev-parse", "main"));
    expect(await git(clone, "rev-parse", "main")).not.toBe(await git(origin, "rev-parse", "main"));
  });

  it("keep the branch itself without an origin", async () => {
    expect(await freshRef(await repo(), "main")).toBe("main");
  });
});
