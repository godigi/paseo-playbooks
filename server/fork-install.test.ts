import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** scripts/fork-install.sh against a stubbed `paseo` and a local stand-in for the fork; nothing real is touched. */
const SCRIPT = path.resolve(__dirname, "../scripts/fork-install.sh");
const root = mkdtempSync(path.join(tmpdir(), "fork-install-test-"));
let prev = "";
let target = "";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

beforeAll(() => {
  const work = path.join(root, "work");
  mkdirSync(work);
  git(work, "init", "-q", "-b", "main");
  writeFileSync(path.join(work, "package.json"), JSON.stringify({ version: "1.0.0" }));
  git(work, "add", "."); git(work, "commit", "-q", "-m", "prev"); prev = git(work, "rev-parse", "HEAD");
  writeFileSync(path.join(work, "package.json"), JSON.stringify({ version: "1.0.1-godigi.1" }));
  git(work, "commit", "-qam", "target"); target = git(work, "rev-parse", "HEAD");
  git(root, "clone", "-q", "--bare", work, path.join(root, "fork.git"));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "paseo"), `#!/bin/bash
echo "$*" >> "$STUB_CALLS"
case "$2" in
  ls) echo '[{"enabled":true,"status":"running","commit":"'$PREV_SHA'","remote":"https://github.com/lerenn/paseo-playbooks.git"}]';;
  remove) [ -n "$FAIL_REMOVE" ] && exit 1; exit 0;;
  install) case "$*" in *"$FAIL_REF"*) exit 1;; esac; exit 0;;
esac
`);
  chmodSync(path.join(bin, "paseo"), 0o755);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function scenario(name: string, runs: Record<string, unknown>, env: Record<string, string> = {}, args: string[] = [target]) {
  const home = path.join(root, name, "home");
  const tmp = path.join(root, name, "tmp");
  mkdirSync(path.join(home, "plugins", "paseo-playbooks", "x", "checkout"), { recursive: true });
  mkdirSync(path.join(home, "plugin-data", "paseo-playbooks", "runs"), { recursive: true });
  mkdirSync(tmp, { recursive: true });
  writeFileSync(path.join(home, "plugins", "sources.json"), "{}");
  for (const [id, run] of Object.entries(runs)) writeFileSync(path.join(home, "plugin-data", "paseo-playbooks", "runs", `${id}.json`), typeof run === "string" ? run : JSON.stringify(run));
  const calls = path.join(root, name, "calls");
  writeFileSync(calls, "");
  const result = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${path.join(root, "bin")}:${process.env.PATH}`, PASEO_HOME: home, TMPDIR: tmp, FORK_URL: path.join(root, "fork.git"), STUB_CALLS: calls, PREV_SHA: prev, POLL_SECS: "3", ...env },
  });
  return { ...result, calls: readFileSync(calls, "utf8").split("\n").filter(Boolean), leaked: readdirSync(tmp) };
}

const idle = { r1: { status: "completed", steps: {} } };

describe("scripts/fork-install.sh", () => {
  it("rolls back to the previous commit when the install fails, and exits non-zero", () => {
    const r = scenario("install-fails", idle, { FAIL_REF: target });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("ROLLBACK OK");
    expect(r.calls.some((c) => c.startsWith("plugin install") && c.includes(`--ref ${prev}`))).toBe(true);
    expect(r.leaked).toEqual([]);
  });

  it("rolls back even when `remove` itself fails (REMOVED is set before remove)", () => {
    const r = scenario("remove-fails", idle, { FAIL_REMOVE: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("FAILED");
    expect(r.calls.some((c) => c.startsWith("plugin install") && c.includes(`--ref ${prev}`))).toBe(true);
  });

  it.each([["pending"], ["queued"], ["paused"], ["running"], ["waiting_gate"]])("refuses on a run with status %s, before remove, leaving no temp dir", (status) => {
    const r = scenario(`idle-${status}`, { ...idle, r2: { status, steps: {} } });
    expect(r.status).toBe(8);
    expect(r.calls.filter((c) => c.startsWith("plugin remove") || c.startsWith("plugin install"))).toEqual([]);
    expect(r.leaked).toEqual([]);
  });

  it("refuses on a run with no status, or a file it cannot parse (fail closed)", () => {
    expect(scenario("idle-nostatus", { r2: { steps: {} } }).status).toBe(8);
    expect(scenario("idle-garbage", { ...idle, bad: "{not json" }).status).toBe(8);
  });

  it("a terminal-only host passes the idle check; --dry-run never calls remove or install", () => {
    const r = scenario("dry", { a: { status: "completed", steps: {} }, b: { status: "failed", steps: {} }, c: { status: "canceled", steps: {} } }, {}, ["--dry-run", target]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("dry run complete: all checks passed");
    expect(r.calls.filter((c) => !c.startsWith("plugin ls"))).toEqual([]);
    expect(r.leaked).toEqual([]);
  });
});
