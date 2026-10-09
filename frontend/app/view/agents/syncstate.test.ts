// frontend/app/view/agents/syncstate.test.ts
import { describe, expect, it } from "vitest";
import { agentsWorkingIn, explainSyncFailure, syncView } from "./syncstate";

const base = { branch: "main", upstream: "origin/main", ahead: 2, behind: 0, running: null, fetchedAgo: "" } as const;

describe("syncView", () => {
    it("counts against the upstream and names it in the title", () => {
        const v = syncView(base);
        expect(v.counts).toBe("↑2 ↓0");
        expect(v.countsTitle).toBe("Against origin/main");
        expect(v.push.label).toBe("Push");
    });
    it("offers Publish and no Pull when the branch has no upstream", () => {
        const v = syncView({ ...base, upstream: "" });
        expect(v.counts).toBe("no upstream");
        expect(v.pull.disabled).toBe(true);
        expect(v.pull.title).toBe("main has no upstream to pull from");
        expect(v.push.label).toBe("Publish");
        expect(v.push.title).toBe("Push and set origin/main as upstream");
    });
    it("disables everything on a detached HEAD", () => {
        const v = syncView({ ...base, branch: "HEAD" });
        expect(v.counts).toBe("detached");
        expect([v.fetch.disabled, v.pull.disabled, v.push.disabled]).toEqual([true, true, true]);
    });
    it("treats an empty branch as detached too", () => {
        const v = syncView({ ...base, branch: "", upstream: "" });
        expect(v.counts).toBe("detached");
        expect([v.fetch.disabled, v.pull.disabled, v.push.disabled]).toEqual([true, true, true]);
    });
    it("spins the running action and holds the other two", () => {
        const v = syncView({ ...base, running: "push" });
        expect(v.push.spinning).toBe(true);
        expect(v.fetch.spinning || v.pull.spinning).toBe(false);
        expect(v.fetch.disabled && v.pull.disabled).toBe(true);
    });
    it("leaves all three enabled and still when nothing runs", () => {
        const v = syncView(base);
        expect([v.fetch.disabled, v.pull.disabled, v.push.disabled]).toEqual([false, false, false]);
        expect([v.fetch.spinning, v.pull.spinning, v.push.spinning]).toEqual([false, false, false]);
    });
    it("titles the three buttons", () => {
        const v = syncView(base);
        expect(v.fetch.title).toBe("Fetch origin");
        expect(v.pull.title).toBe("Pull (fast-forward only)");
        expect(v.push.title).toBe("Push to origin/main");
        expect(syncView({ ...base, fetchedAgo: "3m" }).fetch.title).toBe("Fetch origin · fetched 3m ago");
    });
});

describe("explainSyncFailure", () => {
    it("says a diverged pull must be reconciled in a terminal", () => {
        const s = explainSyncFailure(
            "pull",
            { command: "git pull --ff-only", exitcode: 128, stderr: "fatal: Not possible to fast-forward, aborting." },
            "main",
            "origin/main"
        );
        expect(s).toBe(
            "main and origin/main have diverged. Pull here only fast-forwards; merge or rebase in a terminal."
        );
    });
    it("says a rejected push needs a pull first", () => {
        const s = explainSyncFailure(
            "push",
            { command: "git push", exitcode: 1, stderr: "! [rejected] main -> main (fetch first)" },
            "main",
            "origin/main"
        );
        expect(s).toBe("origin/main has commits you lack. Pull first, then push.");
    });
    it("leaves anything else to git's own words", () => {
        const auth = { command: "git push", exitcode: 128, stderr: "fatal: Authentication failed" };
        expect(explainSyncFailure("push", auth, "main", "origin/main")).toBe("");
        expect(explainSyncFailure("fetch", auth, "main", "origin/main")).toBe("");
    });
    it("does not read a push rejection as a diverged pull, or the reverse", () => {
        const rejected = { command: "git push", exitcode: 1, stderr: "! [rejected] main -> main (fetch first)" };
        const noff = { command: "git pull --ff-only", exitcode: 128, stderr: "fatal: Not possible to fast-forward" };
        expect(explainSyncFailure("pull", rejected, "main", "origin/main")).toBe("");
        expect(explainSyncFailure("push", noff, "main", "origin/main")).toBe("");
    });
});

describe("agentsWorkingIn", () => {
    it("names the working or asking agents whose directory is inside the worktree", () => {
        const agents = [
            { id: "1", name: "fix labels", state: "working" },
            { id: "2", name: "idle one", state: "idle" },
            { id: "3", name: "elsewhere", state: "working" },
        ];
        const cwds = { "1": "D:\\repo\\pkg", "2": "D:\\repo", "3": "D:\\other" };
        expect(agentsWorkingIn("D:/repo", agents, cwds)).toEqual(["fix labels"]);
    });
    it("matches a directory by path segment, not by prefix", () => {
        const agents = [
            { id: "1", name: "sibling", state: "asking" },
            { id: "2", name: "same dir", state: "asking" },
        ];
        const cwds = { "1": "D:\\repo-two", "2": "d:/REPO/" };
        expect(agentsWorkingIn("D:\\repo", agents, cwds)).toEqual(["same dir"]);
    });
    it("skips an agent with no known directory and answers [] for an empty worktree path", () => {
        const agents = [{ id: "1", name: "lost", state: "working" }];
        expect(agentsWorkingIn("D:/repo", agents, {})).toEqual([]);
        expect(agentsWorkingIn("", agents, { "1": "D:/repo" })).toEqual([]);
    });
});
