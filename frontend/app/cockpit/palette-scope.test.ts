// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    backspaceEmpty,
    caretAtEnd,
    cycleScope,
    ghostHint,
    initialNav,
    leaveActions,
    openActionInput,
    openActions,
    openDrill,
    parsePrefix,
    parseProjectLaunch,
    placeholderFor,
    resolveChannelToken,
    SCOPES,
    typeQuery,
    type NavState,
} from "./palette-scope";

const nav = (over: Partial<NavState> = {}): NavState => ({ ...initialNav("cockpit"), ...over });

describe("initialNav", () => {
    it("opens on All everywhere but Code, where the file finder folds in as Files", () => {
        expect(initialNav("cockpit").scope).toBe("all");
        expect(initialNav("files").scope).toBe("all");
        expect(initialNav("code").scope).toBe("files");
    });
});

describe("typeQuery", () => {
    it("turns a sigil typed into an empty All query into its chip", () => {
        expect(typeQuery(nav(), "@")).toMatchObject({ scope: "agents", query: "" });
        expect(typeQuery(nav(), "/")).toMatchObject({ scope: "sessions", query: "" });
        expect(typeQuery(nav(), "#")).toMatchObject({ scope: "projects", query: "" });
        expect(typeQuery(nav(), ">")).toMatchObject({ scope: "commands", query: "" });
    });
    it("keeps the rest of a pasted sigil query as the filter", () => {
        expect(typeQuery(nav(), "@juno")).toMatchObject({ scope: "agents", query: "juno" });
    });
    it("leaves a sigil mid-query as text, so a goal like 'fix #123' stays a goal", () => {
        expect(typeQuery(nav({ query: "fix " }), "fix #")).toMatchObject({ scope: "all", query: "fix #" });
    });
    it("leaves a sigil as text inside a narrowed scope", () => {
        expect(typeQuery(nav({ scope: "files" }), "#")).toMatchObject({ scope: "files", query: "#" });
    });
    it("leaves a sigil as text while a drill or an action list is open", () => {
        const thing = { key: "run:1", title: "palette redesign", noun: "Run" };
        expect(typeQuery(nav({ drill: "theme" }), "@")).toMatchObject({ scope: "all", query: "@" });
        expect(typeQuery(openActions(nav(), thing, 0), "@")).toMatchObject({ scope: "all", query: "@" });
    });
    it("leaves a sigil as text once the query already holds some", () => {
        expect(typeQuery(nav({ query: "a" }), "@a")).toMatchObject({ scope: "all", query: "@a" });
    });
    it("clears a chosen 'as a goal' when a sigil narrows the scope", () => {
        expect(typeQuery(nav({ asGoal: true }), "@")).toMatchObject({ scope: "agents", asGoal: false });
    });
    it("drops a chosen 'as a goal' once the text changes", () => {
        expect(typeQuery(nav({ query: "rad", asGoal: true }), "rada").asGoal).toBe(false);
    });
});

describe("cycleScope", () => {
    it("walks the chips in order and wraps both ways", () => {
        expect(cycleScope(nav(), 1).scope).toBe(SCOPES[1].id);
        expect(cycleScope(nav(), -1).scope).toBe(SCOPES[SCOPES.length - 1].id);
    });
    it("keeps the query and leaves any drill", () => {
        const s = cycleScope(nav({ scope: "commands", drill: "theme", query: "mono" }), 1);
        expect(s).toMatchObject({ query: "mono", drill: null });
    });
});

describe("backspaceEmpty", () => {
    it("does nothing while there is text to delete", () => {
        expect(backspaceEmpty(nav({ scope: "runs", query: "x" }))).toBeNull();
    });
    it("leaves a drill before it leaves the scope", () => {
        const inDrill = openDrill(nav(), "theme");
        const out = backspaceEmpty(inDrill)!;
        expect(out).toMatchObject({ scope: "commands", drill: null });
        expect(backspaceEmpty(out)).toMatchObject({ scope: "all" });
    });
    it("has nothing to leave on an empty All", () => {
        expect(backspaceEmpty(nav())).toBeNull();
    });
});

describe("parseProjectLaunch", () => {
    it("is picker mode for a lone token", () => {
        expect(parseProjectLaunch("back")).toBeNull();
        expect(parseProjectLaunch("backend ")).toBeNull();
    });
    it("is picker mode for a token followed by only more than one space", () => {
        expect(parseProjectLaunch("backend  ")).toBeNull();
    });
    it("skips leading whitespace before the token", () => {
        expect(parseProjectLaunch("   backend fix auth")).toEqual({ token: "backend", goal: "fix auth" });
    });
    it("splits a token and a trimmed goal", () => {
        expect(parseProjectLaunch("backend   fix auth  ")).toEqual({ token: "backend", goal: "fix auth" });
    });
});

describe("resolveChannelToken", () => {
    const channels = [{ name: "backend-api" }, { name: "frontend" }, { name: "Payments" }];
    it("matches an exact name case-insensitively", () => {
        expect(resolveChannelToken("payments", channels)).toEqual({ name: "Payments" });
    });
    it("takes an exact name over a better-ranked fuzzy match, whatever the case", () => {
        const both = [{ name: "app-api" }, { name: "app" }];
        expect(resolveChannelToken("app", both)).toEqual({ name: "app" });
        expect(resolveChannelToken("APP", both)).toEqual({ name: "app" });
    });
    it("takes the highest-scoring fuzzy match, the first of equals", () => {
        expect(resolveChannelToken("bk", [{ name: "b-k" }, { name: "backend" }])).toEqual({ name: "b-k" });
        expect(resolveChannelToken("bet", [{ name: "beta1" }, { name: "beta2" }])).toEqual({ name: "beta1" });
    });
    it("falls back to the best fuzzy match", () => {
        expect(resolveChannelToken("backend", channels)).toEqual({ name: "backend-api" });
    });
    it("returns undefined when nothing matches", () => {
        expect(resolveChannelToken("zzzzz", channels)).toBeUndefined();
    });
});

describe("scope prefixes", () => {
    const all = initialNav("cockpit");
    it("narrows on a typed prefix, letter by letter", () => {
        const r = typeQuery(typeQuery(all, "r"), "r:");
        expect(r).toMatchObject({ scope: "runs", query: "", via: "prefix" });
    });
    it("re: is Records, r: is Runs", () => {
        expect(typeQuery(typeQuery(typeQuery(all, "r"), "re"), "re:").scope).toBe("records");
        expect(typeQuery(all, "r:fix").scope).toBe("runs");
    });
    it("a pasted path stays text", () => {
        expect(typeQuery(all, "c:\\Users\\x")).toMatchObject({ scope: "all", query: "c:\\Users\\x" });
        expect(typeQuery(all, "f:/tmp")).toMatchObject({ scope: "all", query: "f:/tmp" });
    });
    it("a colon after other text is text", () => {
        expect(typeQuery({ ...all, query: "fix" }, "fix:").scope).toBe("all");
        expect(typeQuery({ ...all, query: "x" }, "xr:").scope).toBe("all");
    });
    it("a prefix narrows only while the query is still its own start", () => {
        expect(typeQuery({ ...all, query: "x" }, "r:")).toMatchObject({ scope: "all", query: "r:" });
        expect(typeQuery({ ...all, query: "r:" }, "r:fix")).toMatchObject({ scope: "all", query: "r:fix" });
    });
    it("clears a chosen 'as a goal' when a prefix narrows the scope", () => {
        expect(typeQuery({ ...all, query: "r", asGoal: true }, "r:")).toMatchObject({ scope: "runs", asGoal: false });
    });
    it("sigils still work", () => {
        expect(typeQuery(all, "@juno")).toMatchObject({ scope: "agents", query: "juno" });
    });
    it("n: is Needs you", () => {
        expect(parsePrefix("n:")).toEqual({ scope: "needs", rest: "" });
    });
    it("no: is Notes, typed from an empty All, and n: still narrows to Needs you", () => {
        expect(typeQuery(all, "no:fix")).toMatchObject({ scope: "notes", query: "fix", via: "prefix" });
        expect(typeQuery(all, "n:")).toMatchObject({ scope: "needs" });
    });
    it("Tab reaches Notes right after Records", () => {
        expect(cycleScope(nav({ scope: "records" }), 1).scope).toBe("notes");
    });
});

describe("placeholderFor", () => {
    const all = initialNav("cockpit");
    const thing = { key: "run:1", title: "palette redesign", noun: "Run" };
    it("empty All names the prefixes", () => {
        const p = placeholderFor(all);
        for (const prefix of ["n:", "r:", "a:", "c:"]) expect(p).toContain(prefix);
    });
    it("a scope picked by Tab says which prefix reaches it; one reached by prefix does not", () => {
        expect(placeholderFor(cycleScope(all, 1))).toContain("n:"); // Tab from All lands on Needs you
        expect(placeholderFor(typeQuery(all, "n:"))).not.toContain("n:");
    });
    it("an action drill filters that thing's actions; an input level shows its label", () => {
        const drill = openActions(all, thing, 0);
        expect(placeholderFor(drill)).toBe("Filter Run actions…");
        expect(
            placeholderFor(openActionInput(drill, { actionId: "run:message", label: "Message the lead" }))
        ).toContain("Message the lead");
    });
});

describe("ghostHint", () => {
    it("names the scope a lone prefix letter would narrow to", () => {
        expect(ghostHint("r")).toBe(": narrows to Runs");
        expect(ghostHint("re")).toBe(": narrows to Records");
        expect(ghostHint("n")).toBe(": narrows to Needs you");
        expect(ghostHint("no")).toBe(": narrows to Notes");
    });
    it("is silent otherwise", () => {
        expect(ghostHint("")).toBeNull();
        expect(ghostHint("ru")).toBeNull();
        expect(ghostHint("r ")).toBeNull();
    });
});

describe("action drill", () => {
    const base = { ...initialNav("cockpit"), scope: "runs" as const, query: "palette" };
    const thing = { key: "run:1", title: "palette redesign", noun: "Run" };
    it("opens with an empty filter and restores query and selection on leave", () => {
        const open = openActions(base, thing, 3);
        expect(open.query).toBe("");
        expect(open.actions?.thing).toEqual(thing);
        const left = leaveActions(open)!;
        expect(left.nav).toMatchObject({ scope: "runs", query: "palette", actions: null });
        expect(left.sel).toBe(3);
    });
    it("backspace on an empty filter leaves the input level, then the drill", () => {
        const withInput = openActionInput(openActions(base, thing, 0), {
            actionId: "run:message",
            label: "Message the lead",
        });
        const one = backspaceEmpty({ ...withInput, query: "" })!;
        expect(one.actions?.input).toBeNull();
        const two = backspaceEmpty(one)!;
        expect(two).toMatchObject({ actions: null, query: "palette" });
    });
    it("backspace with text is ordinary", () => {
        expect(backspaceEmpty({ ...openActions(base, thing, 0), query: "c" })).toBeNull();
    });
    it("→ acts only at the end of the query", () => {
        expect(caretAtEnd("abc", 3)).toBe(true);
        expect(caretAtEnd("abc", 1)).toBe(false);
        expect(caretAtEnd("", 0)).toBe(true);
    });
    it("Tab clears an action drill", () => {
        expect(cycleScope(openActions(base, thing, 0), 1).actions).toBeNull();
    });
});
