import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as nodeFs from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    SETUP_SCENARIO_NAMES,
    arrangeSetupFixture,
    assertSetupFixtureInstalled,
    callSummary,
    controlSetupFixture,
    createFixtureRuntime,
    createSetupFixture,
    installSetupFixture,
    readSetupFixture,
    restoreSetupFixture,
    teardownSetupFixture,
} from "./setup-fixtures.mjs";

const roots = [];
function tempRoot() {
    const r = mkdtempSync(join(tmpdir(), "setup-fixtures-test-"));
    roots.push(r);
    return r;
}
afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

// a fake dev app: scripts the helpers send are evaluated against fake window/performance/RpcApi, with
// the dynamic import swapped for the fake module. No browser, no real config.
function fakePage({ prevMock = null, failOn = {} } = {}) {
    const realCalls = [];
    const api = {
        mockClient: prevMock,
        setMockRpcClient(c) {
            if (failOn.restore && c === prevMock) throw new Error("restore refused");
            this.mockClient = c;
        },
        call(client, command, data) {
            return this.mockClient ? this.mockClient.mockWshRpcCall(client, command, data) : client.wshRpcCall(command, data);
        },
        AgentSyncStatusCommand(client) {
            return failOn.probe ? Promise.resolve(null) : this.call(client, "agentsyncstatus", null);
        },
    };
    const win = {
        TabRpcClient: {
            wshRpcCall(command) {
                realCalls.push(command);
                return Promise.resolve({ real: true, command });
            },
            wshRpcStream() {
                throw new Error("unexpected stream");
            },
        },
    };
    const resources = [{ name: "http://localhost:5174/@fs/repo/frontend/app/store/wshclientapi.ts?t=1" }];
    const perf = { getEntriesByType: () => resources };
    const h = {
        scripts: [],
        async ev(expr) {
            h.scripts.push(expr);
            if (failOn.ev?.test(expr)) throw new Error("transport dropped");
            const fn = new Function("window", "performance", "__imp", `return ${expr.replace(/\bimport\(/g, "__imp(")}`);
            return fn(win, perf, async () => ({ RpcApi: api }));
        },
    };
    return { h, api, win, realCalls, resources };
}

const AGENTSYNC = [
    ["agentsyncstatus", null],
    ["agentsyncsteeringread", null],
    ["agentsyncskills", null],
    ["agentsyncsteeringwrite", { content: "x", basemtime: 1000, baseexists: true }],
    ["agentsyncapply", {}],
    ["agentsyncadopt", { apply: false, names: [] }],
    ["agentsyncskillread", { name: "commit-helper" }],
    ["agentsyncskillwrite", { name: "commit-helper", content: "x", basemtime: 0 }],
    ["agentsyncskillcreate", { name: "fresh-skill", description: "d" }],
];

describe("setup fixture safety", () => {
    it("pins the scenario names", () => {
        expect(SETUP_SCENARIO_NAMES).toEqual(["setup-instructions", "setup-skills", "setup-import", "setup-narrow"]);
    });

    it("intercepts every agentsync command and never delegates one", async () => {
        const root = tempRoot();
        const { h, api, realCalls } = fakePage();
        await installSetupFixture(h, createSetupFixture("setup-skills", root));
        for (const [command, data] of AGENTSYNC) {
            await expect(api.call(null, command, data)).resolves.toBeDefined();
        }
        await expect(api.call(null, "agentsyncnew", {})).rejects.toThrow(/unhandled agentsync command/);
        expect(() => api.mockClient.mockWshRpcStream(null, "agentsyncstream", {})).toThrow(/not simulated/);
        expect(realCalls).toEqual([]);
        const snap = await readSetupFixture(h);
        expect(callSummary(snap).unhandled).toBe(1);
    });

    it("routes unrelated commands through the original client, or the prior mock when there is one", async () => {
        const root = tempRoot();
        const plain = fakePage();
        await installSetupFixture(plain.h, createSetupFixture("setup-skills", root));
        await expect(plain.api.call(plain.win.TabRpcClient, "getmeta", {})).resolves.toEqual({ real: true, command: "getmeta" });
        expect(plain.realCalls).toEqual(["getmeta"]);

        const seen = [];
        const prev = {
            mockWshRpcCall: async (_c, command) => {
                seen.push(command);
                return "prior";
            },
        };
        const mocked = fakePage({ prevMock: prev });
        await installSetupFixture(mocked.h, createSetupFixture("setup-skills", tempRoot()));
        await expect(mocked.api.call(null, "getmeta", {})).resolves.toBe("prior");
        expect(seen).toEqual(["getmeta"]);
        expect(mocked.realCalls).toEqual([]);
    });

    it("blocks everything when the module URL cannot be found", async () => {
        const root = tempRoot();
        const { h, resources } = fakePage();
        resources.length = 0;
        await expect(installSetupFixture(h, createSetupFixture("setup-skills", root))).rejects.toThrow(/wshclientapi/);
        expect(existsSync(join(root, "setup-fixture-setup-skills"))).toBe(false);
    });

    it("rolls back when the transport fails before the mock is replaced", async () => {
        const root = tempRoot();
        const prev = { mockWshRpcCall: async () => "prior" };
        const { h, api } = fakePage({ prevMock: prev, failOn: { ev: /const mod = await import/ } });
        await expect(installSetupFixture(h, createSetupFixture("setup-skills", root))).rejects.toThrow(/transport dropped/);
        expect(api.mockClient).toBe(prev);
        expect(existsSync(join(root, "setup-fixture-setup-skills"))).toBe(false);
    });

    it("rolls back when the probe fails after the mock is replaced", async () => {
        const root = tempRoot();
        const prev = { mockWshRpcCall: async () => "prior" };
        const { h, api, win } = fakePage({ prevMock: prev, failOn: { probe: true } });
        await expect(installSetupFixture(h, createSetupFixture("setup-skills", root))).rejects.toThrow(/probe failed/);
        expect(api.mockClient).toBe(prev);
        expect("__arcSetupFixture" in win).toBe(false);
        expect(existsSync(join(root, "setup-fixture-setup-skills"))).toBe(false);
    });

    it("removes owned files and never touches the mock when file creation fails midway", async () => {
        const root = tempRoot();
        const { h, api } = fakePage();
        let writes = 0;
        const fs = {
            ...nodeFs,
            writeFileSync: (...a) => {
                if (++writes === 3) throw new Error("disk full");
                return nodeFs.writeFileSync(...a);
            },
        };
        await expect(installSetupFixture(h, createSetupFixture("setup-skills", root), { fs })).rejects.toThrow(/disk full/);
        expect(api.mockClient).toBeNull();
        expect(h.scripts.some((s) => s.includes("setMockRpcClient(mock)"))).toBe(false);
        expect(existsSync(join(root, "setup-fixture-setup-skills"))).toBe(false);
    });

    it("keeps both errors when the rollback itself fails", async () => {
        const root = tempRoot();
        const { h } = fakePage({ failOn: { probe: true } });
        const fs = {
            ...nodeFs,
            rmSync: () => {
                throw new Error("EBUSY locked");
            },
        };
        const err = await installSetupFixture(h, createSetupFixture("setup-skills", root), { fs }).catch((e) => e);
        expect(err.message).toMatch(/probe failed/);
        expect(err.message).toMatch(/rollback failed: remove fixture files: EBUSY locked/);
        expect(err.errors).toHaveLength(2);
    });

    it("refuses a second install and leaves the first intact", async () => {
        const { h, api } = fakePage();
        await installSetupFixture(h, createSetupFixture("setup-skills", tempRoot()));
        const first = api.mockClient;
        await expect(installSetupFixture(h, createSetupFixture("setup-import", tempRoot()))).rejects.toThrow(/already installed/);
        expect(api.mockClient).toBe(first);
        await expect(assertSetupFixtureInstalled(h)).resolves.toBeUndefined();
    });

    it("restores the prior mock and removes its files after a thrown assertion and a missing UI", async () => {
        const prev = { mockWshRpcCall: async () => "prior" };
        const { h, api } = fakePage({ prevMock: prev });
        const ctx = await arrangeSetupFixture(h, "setup-instructions", { tmpdir: tempRoot() });
        expect(existsSync(ctx.root)).toBe(true);
        try {
            throw new Error("button 'Save & sync' not found");
        } catch {
            // the runner still tears down a context arrange returned
        }
        await teardownSetupFixture(h, ctx);
        expect(api.mockClient).toBe(prev);
        expect(existsSync(ctx.root)).toBe(false);
        await expect(assertSetupFixtureInstalled(h)).rejects.toThrow(/not intercepting/);
    });

    it("fails loudly and keeps intercepting when the prior mock cannot be restored", async () => {
        const { h, api, realCalls } = fakePage({ failOn: { restore: true } });
        const handle = await installSetupFixture(h, createSetupFixture("setup-skills", tempRoot()));
        await expect(restoreSetupFixture(h, handle)).rejects.toThrow(/restore RpcApi mock: restore refused/);
        await expect(api.call(null, "agentsyncapply", {})).resolves.toBeDefined();
        expect(realCalls).toEqual([]);
    });

    it("treats a vanished interception as a failure, not a clean restore", async () => {
        const { h, win } = fakePage();
        const handle = await installSetupFixture(h, createSetupFixture("setup-skills", tempRoot()));
        delete win.__arcSetupFixture;
        await expect(restoreSetupFixture(h, handle)).rejects.toThrow(/interception is gone/);
    });

    it("does not restore over a mock somebody else installed", async () => {
        const { h, api } = fakePage();
        const handle = await installSetupFixture(h, createSetupFixture("setup-skills", tempRoot()));
        const other = { mockWshRpcCall: async () => "other" };
        api.mockClient = other;
        await expect(restoreSetupFixture(h, handle)).rejects.toThrow(/replaced by something else/);
        expect(api.mockClient).toBe(other);
        await expect(assertSetupFixtureInstalled(h)).rejects.toThrow(/replaced/);
    });

    it("cleans its own temp root when arrange fails and keeps both errors", async () => {
        const base = tempRoot();
        const { h } = fakePage({ failOn: { probe: true } });
        const err = await arrangeSetupFixture(h, "setup-skills", { tmpdir: base }).catch((e) => e);
        expect(err.message).toMatch(/probe failed/);
        expect(existsSync(join(base, "setup-fixture-x"))).toBe(false);
        expect(nodeFs.readdirSync(base)).toEqual([]);

        const stuck = fakePage({ failOn: { probe: true } });
        const fs = {
            ...nodeFs,
            rmSync: () => {
                throw new Error("EPERM");
            },
        };
        const both = await arrangeSetupFixture(stuck.h, "setup-skills", { tmpdir: base, fs }).catch((e) => e);
        expect(both.message).toMatch(/probe failed/);
        expect(both.message).toMatch(/EPERM/);
        expect(both.errors.length).toBeGreaterThanOrEqual(2);
    });

    it("rejects unknown scenario names and a missing temp root", () => {
        expect(() => createSetupFixture("nope", tempRoot())).toThrow(/unknown setup fixture/);
        expect(() => createSetupFixture("setup-skills", "")).toThrow(/temp root/);
    });

    it("keeps the controls and snapshot behind the installed gate", async () => {
        const { h } = fakePage();
        await expect(readSetupFixture(h)).rejects.toThrow(/not intercepting/);
        await expect(controlSetupFixture(h, "resetLog")).rejects.toThrow(/not intercepting/);
    });
});

function runtimeFor(name = "setup-import") {
    const fixture = createSetupFixture(name, join(tmpdir(), "unused-root"));
    const rt = createFixtureRuntime(fixture);
    const summary = () => callSummary(rt.snapshot());
    return { fixture, rt, summary };
}

describe("setup fixture transitions", () => {
    it("edits a vault skill with the mtime guard, refuses a shipped one, and apply copies it out", async () => {
        const { rt, summary } = runtimeFor("setup-skills");
        const doc = await rt.call("agentsyncskillread", { name: "commit-helper" });
        expect(doc.content).toContain("commit-helper vault source body");
        await rt.call("agentsyncskillwrite", { name: "commit-helper", content: "edited", basemtime: doc.mtime });
        const stale = await rt.call("agentsyncskillwrite", { name: "commit-helper", content: "again", basemtime: doc.mtime });
        expect(stale.conflict).toBe(true);
        await expect(rt.call("agentsyncskillwrite", { name: "design-local", content: "x", basemtime: 0 })).rejects.toThrow(/ships/);
        let row = (await rt.call("agentsyncskills")).skills.find((k) => k.name === "commit-helper");
        expect(row.states).toEqual({ claude: "differs", codex: "unmanaged" });
        await rt.call("agentsyncapply", {});
        row = (await rt.call("agentsyncskills")).skills.find((k) => k.name === "commit-helper");
        expect(row.states).toEqual({ claude: "synced", codex: "unmanaged" });
        expect(summary()).toMatchObject({ skillWrites: 1 });
    });

    it("creates a vault skill once, under a valid free name", async () => {
        const { rt, summary } = runtimeFor("setup-skills");
        const doc = await rt.call("agentsyncskillcreate", { name: "trade-check", description: "Use when trading" });
        expect(doc.content).toContain("name: trade-check\ndescription: Use when trading\n");
        await expect(rt.call("agentsyncskillcreate", { name: "trade-check", description: "d" })).rejects.toThrow(/exists/);
        await expect(rt.call("agentsyncskillcreate", { name: "identical-copy", description: "d" })).rejects.toThrow(/exists/);
        await expect(rt.call("agentsyncskillcreate", { name: "Bad Name", description: "d" })).rejects.toThrow(/not a skill name/);
        const skills = (await rt.call("agentsyncskills")).skills.map((k) => k.name);
        expect(skills).toContain("trade-check");
        expect(summary()).toMatchObject({ skillCreates: 1 });
    });

    it("separates apply-only from save then apply", async () => {
        const { rt, summary } = runtimeFor();
        await rt.call("agentsyncapply", {});
        expect(summary()).toMatchObject({ applies: 1, applyOnly: 1, applyAfterSave: 0, diskWrites: 0 });
        const read = await rt.call("agentsyncsteeringread");
        await rt.call("agentsyncsteeringwrite", { content: "new", basemtime: read.mtime, baseexists: read.exists });
        await rt.call("agentsyncapply", {});
        expect(summary()).toMatchObject({ applies: 2, applyOnly: 1, applyAfterSave: 1, diskWrites: 1 });
        const status = await rt.call("agentsyncstatus");
        expect(status.harnesses.filter((x) => x.present).map((x) => x.steering)).toEqual(["current", "current"]);
    });

    it("answers an apply with no preceding save as apply-only even after a failed save", async () => {
        const { rt, summary } = runtimeFor();
        rt.control("setDisk", { content: "external" });
        await rt.call("agentsyncsteeringwrite", { content: "mine", basemtime: 1000, baseexists: true });
        await rt.call("agentsyncapply", {});
        expect(summary()).toMatchObject({ applyOnly: 1, applyAfterSave: 0 });
    });

    it("conflicts without writing when the disk changed, and keeps the draft's disk untouched", async () => {
        const { rt, summary } = runtimeFor();
        rt.control("setDisk", { content: "external edit" });
        const res = await rt.call("agentsyncsteeringwrite", { content: "mine", basemtime: 1000, baseexists: true });
        expect(res.conflict).toBe(true);
        const snap = rt.snapshot();
        expect(snap.disk.content).toBe("external edit");
        expect(summary()).toMatchObject({ writeAttempts: 1, writeConflicts: 1, diskWrites: 0, applies: 0 });
    });

    it("pins absent-to-present and present-to-deleted as no-write conflicts, and overwrite as the explicit bypass", async () => {
        const absent = runtimeFor();
        absent.rt.control("useVariant", { key: "doc-absent" });
        const read = await absent.rt.call("agentsyncsteeringread");
        expect(read).toMatchObject({ exists: false, mtime: 0, content: "" });
        absent.rt.control("setDisk", { content: "created elsewhere" });
        const created = await absent.rt.call("agentsyncsteeringwrite", { content: "mine", basemtime: 0, baseexists: false });
        expect(created.conflict).toBe(true);
        expect(absent.summary().diskWrites).toBe(0);

        const present = runtimeFor();
        present.rt.control("setDisk", { exists: false, content: "" });
        const deleted = await present.rt.call("agentsyncsteeringwrite", { content: "mine", basemtime: 1000, baseexists: true });
        expect(deleted.conflict).toBe(true);
        expect(present.summary().diskWrites).toBe(0);

        const forced = await present.rt.call("agentsyncsteeringwrite", {
            content: "mine",
            basemtime: 1000,
            baseexists: true,
            overwrite: true,
        });
        expect(forced.conflict).toBe(false);
        expect(present.summary()).toMatchObject({ diskWrites: 1, overwriteWrites: 1 });
        expect(present.rt.snapshot().disk).toMatchObject({ exists: true, content: "mine" });
    });

    it("treats basemtime 0 without a baseline as read-first, never as an overwrite", async () => {
        const { rt, summary } = runtimeFor();
        await expect(rt.call("agentsyncsteeringwrite", { content: "x", basemtime: 0 })).rejects.toThrow(/read the document first/);
        expect(summary()).toMatchObject({ writeAttempts: 1, diskWrites: 0 });
        const legacy = await rt.call("agentsyncsteeringwrite", { content: "x", basemtime: 1000 });
        expect(legacy.conflict).toBe(false);
    });

    it("logs a stat-error write attempt separately from disk writes and never applies", async () => {
        const { rt, summary } = runtimeFor();
        rt.control("fail", { command: "agentsyncsteeringwrite", message: "stat failed: access denied" });
        await expect(rt.call("agentsyncsteeringwrite", { content: "x", basemtime: 1000, baseexists: true, overwrite: true })).rejects.toThrow(
            /access denied/
        );
        expect(summary()).toMatchObject({ writeAttempts: 1, diskWrites: 0, applies: 0 });
        expect(rt.snapshot().disk.content).toContain("Shared instructions");
    });

    it("invokes neither write nor apply after a failed prerequisite read and a Discard reread", async () => {
        const { rt, summary } = runtimeFor();
        rt.control("fail", { command: "agentsyncsteeringread", message: "read failed", times: 1 });
        await expect(rt.call("agentsyncsteeringread")).rejects.toThrow(/read failed/);
        const reread = await rt.call("agentsyncsteeringread");
        expect(reread.exists).toBe(true);
        expect(summary()).toMatchObject({ writeAttempts: 0, applies: 0, diskWrites: 0 });
        expect(summary().reads.agentsyncsteeringread).toBe(1);
    });

    it("sees a Discard reread pick up a disk change", async () => {
        const { rt } = runtimeFor();
        rt.control("setDisk", { content: "changed under the draft" });
        const reread = await rt.call("agentsyncsteeringread");
        expect(reread.content).toBe("changed under the draft");
        expect(reread.mtime).toBeGreaterThan(1000);
    });

    it("surfaces independent read failures per command and clears them", async () => {
        const { rt } = runtimeFor();
        rt.control("fail", { command: "agentsyncskills", message: "skills unreadable" });
        await expect(rt.call("agentsyncskills")).rejects.toThrow(/skills unreadable/);
        await expect(rt.call("agentsyncstatus")).resolves.toBeDefined();
        rt.control("fail", { command: "agentsyncskills", message: null });
        await expect(rt.call("agentsyncskills")).resolves.toBeDefined();
    });

    it("delays an operation without changing its result", async () => {
        const { rt } = runtimeFor();
        rt.control("delay", { command: "agentsyncapply", ms: 30 });
        const t0 = Date.now();
        await rt.call("agentsyncapply", {});
        expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
    });

    it("keeps a partial apply's changes after the error", async () => {
        const { rt, summary } = runtimeFor();
        rt.control("setDisk", { content: "doc" });
        rt.control("partialApply", { after: 1, message: "write to Codex failed" });
        await expect(rt.call("agentsyncapply", {})).rejects.toThrow(/Codex failed/);
        const status = await rt.call("agentsyncstatus");
        expect(status.harnesses.filter((x) => x.present).map((x) => x.steering)).toEqual(["current", "stale"]);
        expect(summary().applies).toBe(1);
    });

    it("separates an adopt review from an actual apply and records the selection and acknowledgements", async () => {
        const { rt, summary } = runtimeFor();
        const names = ["identical-copy", "differs-body", "ext-managed"];
        const keep = { "differs-body": "claude" };
        const review = await rt.call("agentsyncadopt", { apply: false, names, keep });
        expect(summary()).toMatchObject({ adoptReviews: 1, adoptApplies: 0 });
        expect(summary().lastReview).toMatchObject({ names, keep, acknowledged: [] });
        expect(review.warnings).toEqual([expect.objectContaining({ name: "ext-managed", declaration: "managed-by: skills-manager" })]);
        expect(review.targets.map((t) => `${t.name}:${t.runtime}`)).toContain("differs-body:claude");
        expect(review.unresolved).toEqual([]);

        await expect(
            rt.call("agentsyncadopt", { apply: true, names, keep, reviewtoken: review.reviewtoken })
        ).rejects.toThrow(/acknowledge ownership/);
        expect(rt.snapshot().skills.unmanaged.map((m) => m.name)).toContain("ext-managed");

        await rt.call("agentsyncadopt", {
            apply: true,
            names,
            keep,
            reviewtoken: review.reviewtoken,
            acknowledged: ["ext-managed"],
        });
        expect(summary()).toMatchObject({ adoptApplies: 2, adoptAppliesMoved: 1, adoptRejected: 1 });
        expect(summary().lastAdoptApply).toMatchObject({ names, keep, acknowledged: ["ext-managed"] });
        const after = rt.snapshot().skills;
        expect(after.skills.map((k) => k.name)).toEqual(expect.arrayContaining(names));
        expect(new Set(after.unmanaged.map((m) => m.name))).toEqual(new Set(["codex-only-skill", "fm-delta", "commit-helper"]));
    });

    it("rejects a changed review with no moves and does not adopt newly discovered names", async () => {
        const { rt, summary } = runtimeFor();
        const names = ["identical-copy"];
        const review = await rt.call("agentsyncadopt", { apply: false, names });
        rt.control("changeReview");
        rt.control("discoverNew", { name: "late-arrival", runtime: "claude" });
        await expect(rt.call("agentsyncadopt", { apply: true, names, reviewtoken: review.reviewtoken })).rejects.toThrow(/review changed/);
        expect(rt.snapshot().skills.unmanaged.map((m) => m.name)).toContain("identical-copy");
        expect(summary().adoptRejected).toBe(1);

        const again = await rt.call("agentsyncadopt", { apply: false, names });
        expect(again.reviewtoken).not.toBe(review.reviewtoken);
        await rt.call("agentsyncadopt", { apply: true, names, reviewtoken: again.reviewtoken });
        const left = rt.snapshot().skills.unmanaged.map((m) => m.name);
        expect(left).toContain("late-arrival");
        expect(left).not.toContain("identical-copy");
    });

    it("refuses an apply with no review token for an explicit selection", async () => {
        const { rt } = runtimeFor();
        await expect(rt.call("agentsyncadopt", { apply: true, names: ["identical-copy"] })).rejects.toThrow(/review the selection/);
    });

    it("leaves a body-differing skill unresolved until a keep is chosen", async () => {
        const { rt } = runtimeFor();
        const review = await rt.call("agentsyncadopt", { apply: false, names: ["differs-body"] });
        expect(review.unresolved).toEqual(["differs-body"]);
        expect(review.moves).toEqual([]);
        const kept = await rt.call("agentsyncadopt", { apply: false, names: ["differs-body"], keep: { "differs-body": "codex" } });
        expect(kept.moves.find((m) => m.seed).runtime).toBe("codex");
    });

    it("treats an empty selection as a no-op and rejects bad names, keeps, acknowledgements and canonical collisions", async () => {
        const { rt, summary } = runtimeFor();
        const empty = await rt.call("agentsyncadopt", { apply: true, names: [] });
        expect(empty.moves).toEqual([]);
        expect(rt.snapshot().skills.unmanaged).toHaveLength(9);
        expect(summary().lastAdoptApply).toMatchObject({ outcome: "noop" });
        await expect(rt.call("agentsyncadopt", { apply: false, names: ["ghost"] })).rejects.toThrow(/unknown skill/);
        await expect(rt.call("agentsyncadopt", { apply: false, names: ["commit-helper"] })).rejects.toThrow(/managed skill/);
        await expect(rt.call("agentsyncadopt", { apply: false, names: ["design-local"] })).rejects.toThrow(/managed skill/);
        await expect(
            rt.call("agentsyncadopt", { apply: false, names: ["identical-copy"], keep: { "identical-copy": "opencode" } })
        ).rejects.toThrow(/invalid keep/);
        await expect(
            rt.call("agentsyncadopt", { apply: false, names: ["identical-copy"], acknowledged: ["identical-copy"] })
        ).rejects.toThrow(/invalid acknowledgement/);
    });

    it("keeps legacy adoption off externally declared copies", async () => {
        const { rt } = runtimeFor();
        await rt.call("agentsyncadopt", { apply: true });
        // the body-differing skill has no keep, so it stays too; only the declared copy is the point here
        const left = new Set(rt.snapshot().skills.unmanaged.map((m) => m.name));
        expect(left).toEqual(new Set(["differs-body", "ext-managed", "commit-helper"]));
    });

    it("leaves a canonical-name local shadow alone through sync, adoption and a canonical edit", async () => {
        const { fixture, rt } = runtimeFor("setup-skills");
        const shadow = (snap) => snap.skills.unmanaged.filter((m) => m.name === "commit-helper");
        expect(shadow(rt.snapshot())).toEqual([expect.objectContaining({ runtime: "codex" })]);
        const file = fixture.files.find((f) => f.path === join(shadow(rt.snapshot())[0].from, "SKILL.md"));
        expect(file.content).toContain("local shadow body");
        await rt.call("agentsyncapply", {});
        await rt.call("agentsyncadopt", { apply: true });
        rt.control("editSource", { name: "commit-helper", content: "edited" });
        await rt.call("agentsyncapply", {});
        const snap = rt.snapshot();
        expect(shadow(snap)).toHaveLength(1);
        expect(snap.skills.skills.filter((k) => k.name === "commit-helper")).toHaveLength(1);
        expect(snap.contents.vault["commit-helper"]).toBe("edited");
        await expect(rt.call("agentsyncadopt", { apply: false, names: ["commit-helper"] })).rejects.toThrow(/managed skill/);
    });

    it("reseeds a shipped body on apply, keeps its .arc deltas, and refuses a canonical edit of a shipped skill", async () => {
        const { fixture, rt } = runtimeFor("setup-skills");
        const before = rt.snapshot().contents;
        expect(before.vault["design-local"]).toContain("shipped body v1");
        expect(Object.keys(before.deltas).length).toBeGreaterThan(0);
        const onDisk = fixture.files.find((f) => f.path.endsWith(join("design-local", "SKILL.md")));
        expect(onDisk.content).toBe(before.vault["design-local"]);
        expect(fixture.files.some((f) => f.path.includes(join("design-local", ".arc", "codex", "agents", "openai.yaml")))).toBe(true);
        expect(() => rt.control("editSource", { name: "design-local", content: "x" })).toThrow(/not a user-owned vault skill/);
        await rt.call("agentsyncapply", {});
        const after = rt.snapshot().contents;
        expect(after.vault["design-local"]).toContain("shipped body v2");
        expect(after.dests["design-local/claude"]).toBe(after.vault["design-local"]);
        expect(after.deltas).toEqual(before.deltas);
    });

    it("rewrites managed harness copies after a canonical edit and sync, and leaves the unmanaged shadow's bytes and state", async () => {
        const { fixture, rt } = runtimeFor("setup-skills");
        const states = (snap) => snap.skills.skills.find((k) => k.name === "commit-helper").states;
        const before = rt.snapshot();
        const shadowBytes = fixture.files.find((f) => f.path.endsWith(join("codex", "skills", "commit-helper", "SKILL.md"))).content;
        expect(shadowBytes).toContain("local shadow body");
        expect(before.contents.dests["commit-helper/codex"]).toBe(shadowBytes);
        expect(before.contents.dests["commit-helper/codex"]).not.toBe(before.contents.vault["commit-helper"]);
        expect(states(before)).toEqual({ claude: "synced", codex: "unmanaged" });

        rt.control("editSource", { name: "commit-helper", content: "new body" });
        const edited = rt.snapshot();
        expect(states(edited)).toEqual({ claude: "differs", codex: "unmanaged" });
        expect(edited.contents.dests["commit-helper/codex"]).toBe(shadowBytes);

        await rt.call("agentsyncapply", {});
        const after = rt.snapshot();
        expect(states(after)).toEqual({ claude: "synced", codex: "unmanaged" });
        expect(after.contents.dests["commit-helper/claude"]).toBe("new body");
        expect(after.contents.dests["commit-helper/codex"]).toBe(shadowBytes);
    });

    it("rewrites every managed destination of an edited skill that has no shadow", async () => {
        const { rt } = runtimeFor("setup-skills");
        rt.control("editSource", { name: "vault-drift", content: "drift body" });
        await rt.call("agentsyncapply", {});
        const after = rt.snapshot();
        expect(after.skills.skills.find((k) => k.name === "vault-drift").states).toEqual({ claude: "synced", codex: "synced" });
        expect(after.contents.dests["vault-drift/claude"]).toBe("drift body");
        expect(after.contents.dests["vault-drift/codex"]).toBe("drift body");
    });

    it("compares each copy against the chosen seed, in both keep directions", async () => {
        const { rt } = runtimeFor();
        const movesFor = async (name, keep) =>
            Object.fromEntries((await rt.call("agentsyncadopt", { apply: false, names: [name], keep })).moves.map((m) => [m.runtime, m]));

        const keepClaude = await movesFor("differs-body", { "differs-body": "claude" });
        expect(keepClaude.claude).toMatchObject({ seed: true, bodydiff: false });
        expect(keepClaude.codex).toMatchObject({ seed: false, bodydiff: true });
        const keepCodex = await movesFor("differs-body", { "differs-body": "codex" });
        expect(keepCodex.codex).toMatchObject({ seed: true, bodydiff: false });
        expect(keepCodex.claude).toMatchObject({ seed: false, bodydiff: true });

        // delta-only: the non-seed copy reports what it adds over the seed, and nothing when it adds nothing
        const fmClaude = await movesFor("fm-delta", { "fm-delta": "claude" });
        expect(fmClaude.claude).toMatchObject({ seed: true, bodydiff: false });
        expect(fmClaude.claude.keys).toBeUndefined();
        expect(fmClaude.codex).toMatchObject({ seed: false, bodydiff: false, keys: ["model"], files: ["agents/openai.yaml"] });
        const fmCodex = await movesFor("fm-delta", { "fm-delta": "codex" });
        expect(fmCodex.codex).toMatchObject({ seed: true, bodydiff: false });
        expect(fmCodex.codex.keys).toBeUndefined();
        expect(fmCodex.claude).toMatchObject({ seed: false, bodydiff: false });
        expect(fmCodex.claude.keys).toBeUndefined();
        expect(fmCodex.claude.files).toBeUndefined();

        // no keep: the first copy seeds, matching the listing's own flags
        const dflt = await movesFor("fm-delta", undefined);
        expect(dflt.claude.seed).toBe(true);
        expect(dflt.codex).toMatchObject({ keys: ["model"], files: ["agents/openai.yaml"] });
    });

    it("lists default-plan flags that agree with the comparison the plan makes", async () => {
        const { fixture, rt } = runtimeFor();
        for (const name of ["identical-copy", "fm-delta", "codex-only-skill"]) {
            const planned = (await rt.call("agentsyncadopt", { apply: false, names: [name] })).moves;
            const listed = fixture.skills.unmanaged.filter((m) => m.name === name);
            expect(planned.map((m) => [m.runtime, m.bodydiff, m.keys, m.files])).toEqual(
                listed.map((m) => [m.runtime, m.bodydiff, m.keys, m.files])
            );
        }
        const diff = (await rt.call("agentsyncadopt", { apply: false, names: ["differs-body"] })).unresolved;
        expect(diff).toEqual(fixture.skills.unresolved);
    });

    it("logs a faulted apply and adopt as attempted mutations with their request and error", async () => {
        const { rt, summary } = runtimeFor();
        rt.control("fail", { command: "agentsyncapply", message: "apply exploded" });
        await expect(rt.call("agentsyncapply", {})).rejects.toThrow(/apply exploded/);
        expect(summary()).toMatchObject({ applies: 1, applyErrors: 1, applyOnly: 1 });
        rt.control("fail", { command: "agentsyncadopt", message: "adopt exploded" });
        const names = ["identical-copy"];
        await expect(rt.call("agentsyncadopt", { apply: true, names, keep: {}, acknowledged: [], reviewtoken: "t" })).rejects.toThrow(/adopt exploded/);
        await expect(rt.call("agentsyncadopt", { apply: false, names })).rejects.toThrow(/adopt exploded/);
        expect(summary()).toMatchObject({ adoptApplies: 1, adoptErrors: 1, adoptReviews: 1 });
        expect(summary().lastAdoptApply).toMatchObject({ names, apply: true, outcome: "error", reason: "adopt exploded" });
        expect(summary().lastReview).toMatchObject({ names, apply: false, outcome: "error" });
    });

    it("keeps failed apply attempts out of the apply-after-save count unless a save preceded them", async () => {
        const { rt, summary } = runtimeFor();
        const read = await rt.call("agentsyncsteeringread");
        await rt.call("agentsyncsteeringwrite", { content: "n", basemtime: read.mtime, baseexists: true });
        rt.control("fail", { command: "agentsyncapply", message: "boom" });
        await expect(rt.call("agentsyncapply", {})).rejects.toThrow(/boom/);
        expect(summary()).toMatchObject({ applies: 1, applyAfterSave: 1, applyErrors: 1 });
    });

    it("keeps body flags truthful against the files: identical and delta-only copies share a body", () => {
        const { fixture } = runtimeFor("setup-skills");
        const bodyOf = (path) => fixture.files.find((f) => f.path === path).content.split(/\n---\n/)[1];
        const byName = {};
        for (const c of fixture.skills.unmanaged) (byName[c.name] ??= []).push(c);
        for (const [name, copies] of Object.entries(byName)) {
            const bodies = new Set(copies.map((c) => bodyOf(join(c.from, "SKILL.md"))));
            expect([name, copies.some((c) => c.bodydiff)]).toEqual([name, bodies.size > 1]);
        }
        expect(byName["identical-copy"].map((c) => c.bodydiff)).toEqual([false, false]);
        const fm = byName["fm-delta"];
        expect(fm.some((c) => c.bodydiff)).toBe(false);
        const codexFm = fixture.files.find((f) => f.path === join(fm.find((c) => c.runtime === "codex").from, "SKILL.md")).content;
        expect(codexFm).toContain("model: fixture-model");
    });

    it("hands out skill directories that hold a SKILL.md, for every copy and the discoverable one", async () => {
        const root = tempRoot();
        const fixture = createSetupFixture("setup-import", root);
        const { h } = fakePage();
        const handle = await installSetupFixture(h, fixture);
        for (const c of fixture.skills.unmanaged) {
            expect(c.from.endsWith("SKILL.md")).toBe(false);
            expect(existsSync(join(c.from, "SKILL.md"))).toBe(true);
        }
        const rt = createFixtureRuntime(fixture);
        rt.control("discoverNew", { name: "late-arrival", runtime: "claude" });
        const late = rt.snapshot().skills.unmanaged.find((m) => m.name === "late-arrival");
        expect(existsSync(join(late.from, "SKILL.md"))).toBe(true);
        await restoreSetupFixture(h, handle);
    });

    it("explains a rejected adoption through the installed page runtime, not module scope", async () => {
        const { h, api } = fakePage();
        await installSetupFixture(h, createSetupFixture("setup-import", tempRoot()));
        // the page copy is built from createFixtureRuntime.toString(); a stray module reference would throw ReferenceError
        await expect(api.call(null, "agentsyncadopt", { apply: true, names: ["identical-copy"] })).rejects.toThrow(/review the selection/);
        await expect(api.call(null, "agentsyncadopt", { apply: true, names: ["identical-copy"], reviewtoken: "stale" })).rejects.toThrow(/review changed/);
        await expect(
            api.call(null, "agentsyncadopt", { apply: true, names: ["ext-managed"], reviewtoken: "x" })
        ).rejects.toThrow(/acknowledge ownership/);
        await expect(api.call(null, "agentsyncadopt", { apply: false, names: ["ghost"] })).rejects.toThrow(/unknown skill/);
        const snap = await readSetupFixture(h);
        expect(callSummary(snap)).toMatchObject({ adoptRejected: 3, adoptAppliesMoved: 0 });
        expect(snap.log.filter((e) => e.outcome === "rejected").every((e) => typeof e.reason === "string" && !/not defined/.test(e.reason))).toBe(true);
    });

    it("keeps unselected local copies untouched and survives a partial adopt", async () => {
        const { rt } = runtimeFor();
        const names = ["identical-copy", "fm-delta"];
        const review = await rt.call("agentsyncadopt", { apply: false, names });
        rt.control("partialAdopt", { after: 1, message: "move failed halfway" });
        await expect(rt.call("agentsyncadopt", { apply: true, names, reviewtoken: review.reviewtoken })).rejects.toThrow(/halfway/);
        const snap = rt.snapshot();
        expect(snap.skills.skills.map((k) => k.name)).toContain("identical-copy");
        expect(snap.skills.unmanaged.map((m) => m.name)).toEqual(
            expect.arrayContaining(["fm-delta", "differs-body", "codex-only-skill", "ext-managed"])
        );
    });

    it("supports dirty and conflict import-guard flows: multi-selection with keep and ack, a normal save conflict, no apply", async () => {
        const { rt, summary } = runtimeFor();
        const names = ["identical-copy", "differs-body", "ext-managed"];
        const keep = { "differs-body": "codex" };
        await rt.call("agentsyncadopt", { apply: false, names, keep });
        rt.control("setDisk", { content: "changed on disk" });
        const res = await rt.call("agentsyncsteeringwrite", { content: "draft", basemtime: 1000, baseexists: true });
        expect(res.conflict).toBe(true);
        expect(summary()).toMatchObject({ adoptReviews: 1, adoptApplies: 0, applies: 0, diskWrites: 0 });
        expect(summary().lastReview).toMatchObject({ names, keep });
    });

    it("renders each variant's dataset", async () => {
        const { rt } = runtimeFor("setup-skills");
        rt.control("useVariant", { key: "no-skills" });
        expect((await rt.call("agentsyncskills")).skills).toEqual([]);
        rt.control("useVariant", { key: "pi-absent" });
        expect((await rt.call("agentsyncskills")).piskills).toBeUndefined();
        rt.control("useVariant", { key: "unavailable-column" });
        expect((await rt.call("agentsyncskills")).columns.every((c) => !c.present)).toBe(true);
        expect(() => rt.control("useVariant", { key: "nope" })).toThrow(/unknown variant/);
        expect(() => rt.control("nope")).toThrow(/unknown control/);
    });

    it("covers every ownership and Pi case the boards leave undrawn", () => {
        const { fixture } = runtimeFor("setup-skills");
        const byName = Object.fromEntries(fixture.skills.skills.map((k) => [k.name, k]));
        expect(byName["commit-helper"]).toMatchObject({ sourcekind: "vault" });
        expect(byName["commit-helper"].sourcepath).toContain("commit-helper");
        expect(byName["design-local"]).toMatchObject({ sourcekind: "shipped", sourcepath: "skills/design-local/SKILL.md" });
        expect(byName["legacy-notes"].sourcekind).toBe("unknown");
        expect("sourcekind" in byName["plain-notes"]).toBe(false);
        // both carry a real, inspectable source, so read-only can only come from ownership, not a missing path
        for (const n of ["legacy-notes", "plain-notes"]) {
            const file = fixture.files.find((f) => f.path === byName[n].sourcepath);
            expect(file?.content).toContain(`${n} vault source body`);
            expect(relative(fixture.ownedDir, byName[n].sourcepath).startsWith("..")).toBe(false);
        }
        expect(byName["design-local"].deltas).toEqual({ codex: ["agents/openai.yaml"] });
        expect(fixture.skills.piskills.sources.some((s) => s.runtime === "claude" && s.entry.startsWith("~/"))).toBe(true);
        expect(fixture.skills.piskills.sources.every((s) => !s.path.includes("\\"))).toBe(true);
        const states = new Set(Object.values(fixture.skills.piskills.states));
        expect([...states]).toEqual(expect.arrayContaining(["available", "not-synced", "excluded", "unknown"]));
        const copies = fixture.skills.unmanaged;
        expect(copies.filter((c) => c.name === "codex-only-skill")).toHaveLength(1);
        expect(copies.some((c) => c.name === "fm-delta" && c.keys?.length && c.files?.length && !c.bodydiff)).toBe(true);
    });

    it("keeps every source file under the fixture's own temp folder and removes only that folder", async () => {
        const root = tempRoot();
        const sibling = join(root, "keep-me.txt");
        writeFileSync(sibling, "mine");
        const fixture = createSetupFixture("setup-skills", root);
        for (const f of fixture.files) {
            const rel = relative(fixture.ownedDir, f.path);
            expect(rel.startsWith("..")).toBe(false);
        }
        const { h } = fakePage();
        const handle = await installSetupFixture(h, fixture);
        const vault = fixture.skills.skills.find((k) => k.name === "commit-helper");
        expect(existsSync(vault.sourcepath)).toBe(true);
        expect(vault.sourcepath.startsWith(root)).toBe(true);
        const ownership = fixture.skills.skills.filter((k) => k.name === "legacy-notes" || k.name === "plain-notes");
        expect(ownership).toHaveLength(2);
        for (const row of ownership) {
            expect(readFileSync(row.sourcepath, "utf8")).toContain(`${row.name} vault source body`);
        }
        await restoreSetupFixture(h, handle);
        ownership.forEach((row) => expect(existsSync(row.sourcepath)).toBe(false));
        expect(existsSync(fixture.ownedDir)).toBe(false);
        expect(existsSync(sibling)).toBe(true);
        expect(existsSync(root)).toBe(true);
    });

    it("refuses a fixture file outside its own folder", async () => {
        const root = tempRoot();
        const fixture = createSetupFixture("setup-skills", root);
        fixture.files.push({ path: join(root, "..", "escaped.md"), content: "x" });
        const { h } = fakePage();
        await expect(installSetupFixture(h, fixture)).rejects.toThrow(/outside its temporary folder/);
        expect(h.scripts).toEqual([]);
    });

    it("keeps the page-visible state to the fixture's own runtime", async () => {
        const { h, win } = fakePage();
        await installSetupFixture(h, createSetupFixture("setup-skills", tempRoot()));
        const snap = await readSetupFixture(h);
        expect(Object.keys(snap).sort()).toEqual(["contents", "controls", "disk", "log", "diskWrites", "skills", "status"].sort());
        expect(Object.keys(win).sort()).toEqual(["TabRpcClient", "__arcSetupFixture"]);
    });
});
