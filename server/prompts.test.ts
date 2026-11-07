import { describe, expect, it } from "vitest";
import type { Playbook } from "../shared/types";
import { MANAGER_PROTOCOL, managerInstructionsText, managerTakeover } from "./prompts";

/** Only the fields the manager prompts read. */
function playbook(managerInstructions: Playbook["managerInstructions"]): Playbook {
  return { id: "pr", managerInstructions } as unknown as Playbook;
}

describe("manager instructions", () => {
  it("list each source, the repository first, and indent multi-line texts", () => {
    const text = managerInstructionsText(playbook([
      { playbook: null, text: "Write in English." },
      { playbook: "pr", text: "Check the PR exists.\nThen brief the reviewer." },
    ]));
    expect(text).toBe(
      "Instructions for this run (they add to the rules above, never replace them):\n" +
        "- repository: Write in English.\n" +
        "- pr: Check the PR exists.\n  Then brief the reviewer.",
    );
  });

  it("are left out when there are none, also on runs from before them", () => {
    expect(managerInstructionsText(playbook([]))).toBe("");
    expect(managerInstructionsText({ id: "pr" } as unknown as Playbook)).toBe("");
  });

  it("follow the protocol in a takeover", () => {
    const prompt = managerTakeover({ id: "run_1", playbook: playbook([{ playbook: "pr", text: "Be brief." }]), inputs: {} }, ["a"]);
    expect(prompt.startsWith(MANAGER_PROTOCOL)).toBe(true);
    expect(prompt.indexOf("- pr: Be brief.")).toBeGreaterThan(MANAGER_PROTOCOL.length);
  });
});
