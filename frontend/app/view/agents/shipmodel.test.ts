// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { canShip, mergeLabel, mergePrompt, SHIP_PROMPTS, shipOffer, type ShipGit } from "./shipmodel";

const agent = (over: Partial<AgentVM> = {}): AgentVM => ({
    id: "tab1",
    name: "loom",
    task: "",
    state: "idle",
    blockId: "b1",
    ...over,
});

const git = (over: Partial<ShipGit> = {}): ShipGit => ({ dirty: 0, ahead: 0, upstream: "origin/main", ...over });

describe("canShip", () => {
    it("takes an idle, awake agent with a terminal", () => {
        expect(canShip(agent())).toBe(true);
    });

    it("refuses a terminal, a background agent, a working one, a sleeping one, a run's and one with no block", () => {
        expect(canShip(agent({ kind: "terminal" }))).toBe(false);
        expect(canShip(agent({ kind: "background" }))).toBe(false);
        expect(canShip(agent({ state: "working" }))).toBe(false);
        expect(canShip(agent({ state: "asking" }))).toBe(false);
        expect(canShip(agent({ sleeping: { since: 1, freedBytes: 0 } }))).toBe(false);
        expect(canShip(agent({ runId: "r1" }))).toBe(false);
        expect(canShip(agent({ blockId: undefined }))).toBe(false);
    });
});

describe("shipOffer", () => {
    it("offers Ship for a turn that left edits in a dirty tree", () => {
        const offer = shipOffer(agent({ edited: true }), git({ dirty: 3 }));
        expect(offer?.kind).toBe("ship");
        expect(offer?.title).toContain("3 files");
        expect(offer?.title).toContain("origin/main");
    });

    it("offers Ship for a turn that committed while the branch is ahead", () => {
        const offer = shipOffer(agent({ committed: true }), git({ ahead: 2 }));
        expect(offer?.kind).toBe("ship");
        expect(offer?.title).toMatch(/^Pull and resolve/);
        expect(offer?.title).toContain("↑2");
    });

    it("stays quiet for a committed turn whose dirty files are someone else's and nothing to push", () => {
        expect(shipOffer(agent({ committed: true }), git({ dirty: 5 }))).toBeNull();
    });

    it("stays quiet for a turn that did no git work, however dirty the shared checkout is", () => {
        expect(shipOffer(agent(), git({ dirty: 5, ahead: 3 }))).toBeNull();
    });

    it("stays quiet once everything is shipped", () => {
        expect(shipOffer(agent({ edited: true }), git())).toBeNull();
        expect(shipOffer(agent({ committed: true }), git())).toBeNull();
    });

    it("waits for a git read, and for an agent stopped on a part", () => {
        expect(shipOffer(agent({ edited: true }), null)).toBeNull();
        expect(shipOffer(agent({ edited: true, step: "1/3" }), git({ dirty: 1 }))).toBeNull();
    });

    it("offers no chip on an agent that cannot take the prompt", () => {
        expect(shipOffer(agent({ edited: true, state: "working" }), git({ dirty: 1 }))).toBeNull();
        expect(shipOffer(agent({ edited: true, runId: "r1" }), git({ dirty: 1 }))).toBeNull();
    });

    it("offers Commit when the branch tracks no upstream", () => {
        expect(shipOffer(agent({ edited: true }), git({ dirty: 1, upstream: "" }))?.kind).toBe("commit");
        expect(shipOffer(agent({ committed: true }), git({ upstream: "" }))).toBeNull();
    });
});

describe("prompts", () => {
    it("Ship commits only the agent's own files and is the yes to push", () => {
        expect(SHIP_PROMPTS.ship).toContain("GIT_INDEX_FILE");
        expect(SHIP_PROMPTS.ship).toContain("my yes to push");
        expect(SHIP_PROMPTS.commit).toContain("Don't pull or push");
    });

    it("a refused Pull asks for a merge without a push, a refused Push goes on to push", () => {
        const pull = mergePrompt("pull", "/repo", "main", "origin/main");
        expect(pull).toContain("main in /repo and origin/main have diverged");
        expect(pull).toContain("Don't push");
        const push = mergePrompt("push", "/repo", "main", "origin/main");
        expect(push).toContain("origin/main has commits main in /repo lacks");
        expect(push).toContain("my yes to push");
        expect(mergeLabel("pull", "loom")).toBe("Ask loom to merge");
        expect(mergeLabel("push", "loom")).toBe("Ask loom to pull and push");
    });
});
