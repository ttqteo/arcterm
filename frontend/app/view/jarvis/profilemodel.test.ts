import { describe, expect, it } from "vitest";
import {
    applyApprovals,
    approvalsRow,
    defaultReach,
    DIAGNOSTIC_MISSING_DISABLED,
    DIAGNOSTIC_MISSING_REPLACEMENT,
    isDirty,
    lightReviewerRow,
    overrideSummary,
    principleNote,
    principleRows,
    principleSummary,
    profileOverrideIsEmpty,
    type ProjectOverride,
    reduceGlobalPrinciples,
    reducePlaybook,
    reducePrinciplePatch,
    resetActionState,
    resetRow,
} from "./profilemodel";

const G: Principle[] = [
    { id: "a", text: "Alpha" },
    { id: "b", text: "Bravo" },
    { id: "c", text: "Charlie" },
];

describe("reducePrinciplePatch", () => {
    it("override adds a replacement immutably", () => {
        const before = undefined;
        const after = reducePrinciplePatch(before, { type: "override", id: "b", text: "B2" });
        expect(after).toEqual({ replacements: { b: "B2" } });
    });
    it("reset removes the replacement and empties back to undefined", () => {
        const start: PrinciplePatch = { replacements: { b: "B2" } };
        const after = reducePrinciplePatch(start, { type: "reset", id: "b" });
        expect(after).toBeUndefined();
        // original is untouched
        expect(start).toEqual({ replacements: { b: "B2" } });
    });
    it("disable then reenable is a no-op that collapses to undefined", () => {
        const disabled = reducePrinciplePatch(undefined, { type: "disable", id: "a" });
        expect(disabled).toEqual({ disabled: ["a"] });
        const reenabled = reducePrinciplePatch(disabled, { type: "reenable", id: "a" });
        expect(reenabled).toBeUndefined();
    });
    it("disable does not duplicate an already-disabled id", () => {
        const once = reducePrinciplePatch({ disabled: ["a"] }, { type: "disable", id: "a" });
        expect(once).toEqual({ disabled: ["a"] });
    });
    it("add / update-addition / delete-addition operate on additions only", () => {
        const added = reducePrinciplePatch(undefined, { type: "add", principle: { id: "p1", text: "" } });
        expect(added).toEqual({ additions: [{ id: "p1", text: "" }] });
        const edited = reducePrinciplePatch(added, { type: "update-addition", id: "p1", text: "hi" });
        expect(edited).toEqual({ additions: [{ id: "p1", text: "hi" }] });
        const deleted = reducePrinciplePatch(edited, { type: "delete-addition", id: "p1" });
        expect(deleted).toBeUndefined();
    });
    it("preserves unrelated fields and order", () => {
        const start: PrinciplePatch = { additions: [{ id: "p1", text: "one" }], disabled: ["a"] };
        const after = reducePrinciplePatch(start, { type: "override", id: "b", text: "B2" });
        expect(after).toEqual({ additions: [{ id: "p1", text: "one" }], replacements: { b: "B2" }, disabled: ["a"] });
        expect(start.additions).toBe(start.additions); // sanity: start not mutated below
        expect(start).toEqual({ additions: [{ id: "p1", text: "one" }], disabled: ["a"] });
    });
});

describe("principleRows", () => {
    it("maps inherited/modified/disabled/project rows in order", () => {
        const patch: PrinciplePatch = {
            replacements: { b: "Bravo!" },
            disabled: ["c"],
            additions: [{ id: "p1", text: "Project one" }],
        };
        const rows = principleRows(G, patch, []);
        expect(rows).toEqual([
            { id: "a", text: "Alpha", kind: "inherited" },
            { id: "b", text: "Bravo!", kind: "modified", originalText: "Bravo" },
            { id: "c", text: "Charlie", kind: "disabled" },
            { id: "p1", text: "Project one", kind: "project" },
        ]);
    });
    it("emits stale rows for diagnostics referencing missing globals", () => {
        const patch: PrinciplePatch = { replacements: { gone: "x" }, disabled: ["also-gone"] };
        const diags: PrincipleDiagnostic[] = [
            { code: DIAGNOSTIC_MISSING_REPLACEMENT, principleid: "gone" },
            { code: DIAGNOSTIC_MISSING_DISABLED, principleid: "also-gone" },
        ];
        const rows = principleRows(G, patch, diags);
        const stale = rows.filter((r) => r.kind === "stale");
        expect(stale).toEqual([
            { id: "gone", text: "x", kind: "stale", diagnostic: DIAGNOSTIC_MISSING_REPLACEMENT },
            { id: "also-gone", text: "", kind: "stale", diagnostic: DIAGNOSTIC_MISSING_DISABLED },
        ]);
    });
    it("handles an undefined patch as all-inherited", () => {
        const rows = principleRows(G, undefined, []);
        expect(rows.every((r) => r.kind === "inherited")).toBe(true);
        expect(rows).toHaveLength(3);
    });
});

describe("isDirty", () => {
    it("treats a structurally empty patch as equal to undefined", () => {
        expect(isDirty({}, { principles: {} })).toBe(false);
        expect(isDirty({ principles: { additions: [], disabled: [] } }, {})).toBe(false);
    });
    it("treats a route-only override as project-scoped and dirty", () => {
        expect(isDirty({}, { route: { runtime: "pi" } })).toBe(true);
        expect(isDirty({ route: undefined }, { route: undefined })).toBe(false);
    });
    it("is true when the patch differs meaningfully", () => {
        expect(isDirty({}, { principles: { disabled: ["a"] } })).toBe(true);
        expect(
            isDirty({ principles: { replacements: { a: "x" } } }, { principles: { replacements: { a: "y" } } })
        ).toBe(true);
        expect(isDirty({ defaultmode: "quick" }, {})).toBe(true);
    });
});

describe("reduceGlobalPrinciples", () => {
    const base: Principle[] = [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
    ];
    it("add appends a caller-built principle", () => {
        expect(reduceGlobalPrinciples(base, { type: "add", principle: { id: "c", text: "" } })).toEqual([
            { id: "a", text: "A" },
            { id: "b", text: "B" },
            { id: "c", text: "" },
        ]);
    });
    it("update changes text by id only", () => {
        const out = reduceGlobalPrinciples(base, { type: "update", id: "a", text: "A2" });
        expect(out[0].text).toBe("A2");
        expect(out[1].text).toBe("B");
    });
    it("delete removes by id", () => {
        expect(reduceGlobalPrinciples(base, { type: "delete", id: "a" })).toEqual([{ id: "b", text: "B" }]);
    });
    it("move swaps neighbors", () => {
        expect(reduceGlobalPrinciples(base, { type: "move", id: "b", dir: -1 }).map((p) => p.id)).toEqual(["b", "a"]);
    });
    it("move out of bounds is a no-op", () => {
        expect(reduceGlobalPrinciples(base, { type: "move", id: "a", dir: -1 })).toEqual(base);
    });
});

// The frontend mirror of jarvis.ProfileOverrideIsEmpty: reaching it must mean every section is absent, so
// an override that carries only engine defaults is never mistaken for a cleared one.
describe("profileOverrideIsEmpty", () => {
    const cases: Array<[string, ProfileOverride | null | undefined, boolean]> = [
        ["nil", null, true],
        ["bare", {}, true],
        ["empty patch", { principles: {} }, true],
        ["parallelism", { parallelism: 3 }, false],
        ["worker route", { workerroute: { runtime: "pi" } }, false],
        ["lead route", { route: { runtime: "pi" } }, false],
        ["default mode", { defaultmode: "orchestrator" }, false],
        ["landing", { landing: "branch" }, false],
        ["approvals", { autonomous: false }, false],
        ["patch with a disable", { principles: { disabled: ["a"] } }, false],
    ];
    for (const [name, override, want] of cases) {
        it(`${name} -> ${want}`, () => {
            expect(profileOverrideIsEmpty(override)).toBe(want);
        });
    }
});

// Every row of the future-run defaults: reset drops the section's override from the draft. Dropping a key
// while the draft is being written would mutate what is in flight, so the save's duration disables it.
describe("resetActionState", () => {
    it("offers a reset only where the project overrides the global", () => {
        expect(resetActionState(false, false)).toEqual({ show: true, disabled: false });
        expect(resetActionState(true, false).show).toBe(false);
    });

    it("disables every row's reset for the whole save", () => {
        expect(resetActionState(false, true)).toEqual({ show: true, disabled: true });
    });
});

// The playbook is the phase list a pipeline run is composed from. Phases carry no id, so every action is
// addressed by position and the reducer has to survive an index that no longer exists.
describe("reducePlaybook", () => {
    const P: RunPhase[] = [
        { kind: "brainstorm", state: "pending" },
        { kind: "plan", state: "pending", gate: true },
        { kind: "execute", state: "pending", freshctx: true },
    ];

    it("appends a pending custom phase, the one kind that needs no skill to mean something", () => {
        const next = reducePlaybook(P, { type: "add" });
        expect(next).toHaveLength(4);
        expect(next[3]).toEqual({ kind: "custom", state: "pending" });
    });

    it("replaces one phase and leaves the rest identical", () => {
        const next = reducePlaybook(P, { type: "update", index: 1, phase: { ...P[1], skill: "writing-plans" } });
        expect(next[1].skill).toBe("writing-plans");
        expect(next[0]).toBe(P[0]);
        expect(next[2]).toBe(P[2]);
    });

    it("removes by position", () => {
        expect(reducePlaybook(P, { type: "remove", index: 0 }).map((p) => p.kind)).toEqual(["plan", "execute"]);
    });

    it("swaps a phase with its neighbour", () => {
        expect(reducePlaybook(P, { type: "move", index: 2, dir: -1 }).map((p) => p.kind)).toEqual([
            "brainstorm",
            "execute",
            "plan",
        ]);
    });

    it("never mutates the input", () => {
        reducePlaybook(P, { type: "move", index: 0, dir: 1 });
        expect(P.map((p) => p.kind)).toEqual(["brainstorm", "plan", "execute"]);
    });

    // a click that lands after the list has shrunk must not corrupt the draft
    it("returns the list unchanged for a move off either end or past the end of the list", () => {
        expect(reducePlaybook(P, { type: "move", index: 0, dir: -1 })).toBe(P);
        expect(reducePlaybook(P, { type: "move", index: 2, dir: 1 })).toBe(P);
        expect(reducePlaybook(P, { type: "move", index: 9, dir: -1 })).toBe(P);
    });

    it("is a no-op for an update or remove that names a phase which is gone", () => {
        expect(reducePlaybook(P, { type: "update", index: 7, phase: P[0] })).toEqual(P);
        expect(reducePlaybook(P, { type: "remove", index: 7 })).toEqual(P);
    });
});

describe("overrideSummary", () => {
    it("counts the rows a project sets, including the lead route", () => {
        expect(overrideSummary({})).toBe("All from global");
        expect(overrideSummary({ parallelism: 3, route: { runtime: "claude" } })).toBe("2 set for this project");
    });
    it("counts where runs land", () => {
        expect(overrideSummary({ landing: "checkout" })).toBe("1 set for this project");
    });
    it("does not count principles, which have their own section", () => {
        expect(overrideSummary({ principles: { disabled: ["a"] } })).toBe("All from global");
    });
});

describe("principleSummary", () => {
    it("says so when the project changes nothing", () => {
        expect(principleSummary(principleRows(G, undefined, []))).toBe("3 from global, no changes here");
    });
    it("counts customized, added and disabled, keeping disabled globals in the global count", () => {
        const patch: PrinciplePatch = {
            replacements: { a: "A2" },
            disabled: ["b"],
            additions: [{ id: "p1", text: "Mine" }],
        };
        expect(principleSummary(principleRows(G, patch, []))).toBe(
            "3 from global · 1 customized · 1 added · 1 disabled"
        );
    });
});

// The Approvals row: a project's own value, Ask me included, holds over the global; Reset drops it back.
describe("approvals row", () => {
    const global = (autonomous?: boolean): JarvisProfile => ({ autonomous }) as JarvisProfile;

    it("an override with only autonomous is not empty and reads as Project", () => {
        const o: ProfileOverride = { autonomous: true };
        expect(profileOverrideIsEmpty(o)).toBe(false);
        expect(approvalsRow(o, global(), true)).toEqual({ autonomous: true, inherited: false });
        expect(overrideSummary(o)).toBe("1 set for this project");
    });
    it("Reset removes it and the row reads Global", () => {
        const after = resetRow({ autonomous: true, landing: "checkout" }, "autonomous");
        expect(after).toEqual({ landing: "checkout" });
        expect(approvalsRow(after, global(true), true)).toEqual({ autonomous: true, inherited: true });
        expect(profileOverrideIsEmpty(resetRow({ autonomous: false }, "autonomous"))).toBe(true);
    });
    it("a project false over a global true is a stated value, not inheritance", () => {
        const o = applyApprovals<ProfileOverride>({}, false, true);
        expect(o).toEqual({ autonomous: false });
        expect(approvalsRow(o, global(true), true)).toEqual({ autonomous: false, inherited: false });
    });
    it("global scope unsets Ask me rather than storing false", () => {
        const g = global(true);
        expect("autonomous" in applyApprovals(g, false, false)).toBe(false);
        expect(applyApprovals({} as JarvisProfile, true, false).autonomous).toBe(true);
        expect(approvalsRow(g, g, false)).toEqual({ autonomous: true, inherited: false });
    });
    it("counts a project's own approvals against the global one", () => {
        expect(defaultReach([P("opal"), P("wave", { autonomous: false })], "autonomous")).toEqual({
            main: "1 of 2 projects",
            sub: "wave sets its own",
        });
    });
});

// a row's Reset drops just that row; the workers row drops both halves of its pair
describe("resetRow", () => {
    it("drops only the named key", () => {
        expect(resetRow({ landing: "checkout", parallelism: 3 }, "landing")).toEqual({ parallelism: 3 });
    });
    it("drops worker route and reviewer picks together", () => {
        expect(resetRow({ reviewerpicks: false, landing: "branch" }, "workerroute")).toEqual({ landing: "branch" });
    });
});

const P = (name: string, override: ProfileOverride = {}): ProjectOverride => ({ name, override });

describe("defaultReach", () => {
    it("is null with no projects to reach", () => {
        expect(defaultReach([], "parallelism")).toBeNull();
    });
    it("reaches every project that sets nothing", () => {
        expect(defaultReach([P("opal"), P("wave")], "parallelism")).toEqual({ main: "All 2 projects" });
        expect(defaultReach([P("opal")], "parallelism")).toEqual({ main: "1 project" });
    });
    it("names the one project that sets its own", () => {
        expect(defaultReach([P("opal"), P("wave", { defaultmode: "orchestrator" })], "defaultmode")).toEqual({
            main: "1 of 2 projects",
            sub: "wave sets its own",
        });
    });
    it("counts several projects that set their own, and none reached", () => {
        const all = [P("a", { workerroute: { runtime: "pi" } }), P("b", { workerroute: { runtime: "claude" } })];
        expect(defaultReach(all, "workerroute")).toEqual({ main: "No projects", sub: "2 set their own" });
    });
    it("counts a project's own landing against the global one", () => {
        expect(defaultReach([P("opal"), P("wave", { landing: "checkout" })], "landing")).toEqual({
            main: "1 of 2 projects",
            sub: "wave sets its own",
        });
    });
});

describe("principleNote", () => {
    it("is null when no project touches the principle", () => {
        expect(principleNote([P("opal")], "a", false)).toBeNull();
    });
    it("names rewording and disabling projects", () => {
        const projects = [
            P("opal", { principles: { replacements: { a: "A2" } } }),
            P("wave", { principles: { disabled: ["a"] } }),
        ];
        expect(principleNote(projects, "a", false)).toEqual({
            text: "opal uses its own wording · Disabled in wave",
            warn: false,
        });
    });
    it("lets a disable win over a replacement in the same project", () => {
        const projects = [P("opal", { principles: { replacements: { a: "A2" }, disabled: ["a"] } })];
        expect(principleNote(projects, "a", false)?.text).toBe("Disabled in opal");
    });
    it("warns while the principle is edited", () => {
        const projects = [
            P("opal", { principles: { replacements: { a: "A2" } } }),
            P("wave", { principles: { replacements: { a: "A3" } } }),
            P("zinc", { principles: { disabled: ["a"] } }),
        ];
        expect(principleNote(projects, "a", true)).toEqual({ text: "This edit won't reach 3 projects", warn: true });
    });
});

describe("lightReviewerRow", () => {
    const ROUTE: RoutePin = { runtime: "claude", model: "haiku" };
    const OTHER: RoutePin = { runtime: "pi", model: "gpt" };

    it("names the Sonnet default when nothing is set, globally or with no global route", () => {
        expect(lightReviewerRow({}, {} as JarvisProfile, false)).toEqual({
            value: null,
            inheritedLabel: "Sonnet (default)",
        });
        expect(lightReviewerRow({}, {} as JarvisProfile, true)).toEqual({
            value: null,
            inheritedLabel: "Sonnet (default)",
        });
    });

    it("names the global route a project inherits, and shows a project's own", () => {
        const base = { lightreviewerroute: ROUTE } as JarvisProfile;
        expect(lightReviewerRow({}, base, true)).toEqual({ value: null, inheritedLabel: "Same as global" });
        expect(lightReviewerRow({ lightreviewerroute: OTHER }, base, true).value).toEqual(OTHER);
        expect(lightReviewerRow({ lightreviewerroute: ROUTE }, {} as JarvisProfile, false).value).toEqual(ROUTE);
    });

    it("counts as a project's own row", () => {
        expect(profileOverrideIsEmpty({ lightreviewerroute: ROUTE })).toBe(false);
        expect(overrideSummary({ lightreviewerroute: ROUTE })).toBe("1 set for this project");
        expect(resetRow({ lightreviewerroute: ROUTE }, "lightreviewerroute")).toEqual({});
    });
});
