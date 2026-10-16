// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { ThingAction, ThingEntry, ThingKindDef } from "./actions/types";
import { actionListGroups, resolveActionRow, verbGroupLabel, verbLeads } from "./palette-actionrows";

interface Job {
    live: boolean;
}

const action = (id: string, label: string, group: ThingAction<Job>["group"], applies: (j: Job) => boolean) => ({
    id,
    label,
    group,
    applies,
    run: () => {},
});

const JOB_KIND: ThingKindDef<Job> = {
    kind: "run",
    noun: "Run",
    // registry order deliberately mixes groups: the list must still read open, steer, stop
    actions: [
        action("job:cancel", "Cancel run", "stop", (j) => j.live),
        action("job:open", "Open in Jarvis", "open", () => true),
        action("job:resume", "Resume", "steer", (j) => !j.live),
        action("job:dag", "Open the DAG", "open", () => true),
        action("job:end", "End final stage", "stop", () => false),
    ],
    entries: () => [],
};

const entry = (live: boolean): ThingEntry<Job> => ({ key: "run:1", title: "fix flaky verify", thing: { live } });
const shape = (r: ReturnType<typeof actionListGroups<Job>>) =>
    r.groups.map((g) => [g.key, g.label, g.actions.map((a) => a.id)]);

describe("actionListGroups", () => {
    it("lists open, steer, stop in that order, dropping a section with nothing that applies", () => {
        const r = actionListGroups(JOB_KIND, entry(true), "");
        expect(shape(r)).toEqual([
            ["open", "Open", ["job:open", "job:dag"]],
            ["stop", "Stop", ["job:cancel"]],
        ]);
    });

    it("names what does not apply now on the Not now line", () => {
        expect(actionListGroups(JOB_KIND, entry(true), "").notNow).toBe("Not now: Resume, End final stage");
        expect(actionListGroups(JOB_KIND, entry(false), "").notNow).toBe("Not now: Cancel run, End final stage");
    });

    it("has no Not now line when everything applies", () => {
        const all: ThingKindDef<Job> = { ...JOB_KIND, actions: JOB_KIND.actions.slice(1, 2) };
        expect(actionListGroups(all, entry(true), "").notNow).toBeNull();
    });

    it("filters the actions by the query", () => {
        const r = actionListGroups(JOB_KIND, entry(true), "dag");
        expect(shape(r)).toEqual([["open", "Open", ["job:dag"]]]);
    });

    it("keeps the Not now line when the query filters everything out", () => {
        const r = actionListGroups(JOB_KIND, entry(true), "resume");
        expect(r.groups).toEqual([]);
        expect(r.notNow).toBe("Not now: Resume, End final stage");
    });
});

describe("resolveActionRow", () => {
    const plain = action("job:cancel", "Cancel run", "stop", () => true);

    it("names a plain action by its label, Enter by the label's first word", () => {
        expect(resolveActionRow(plain, entry(true))).toEqual({
            title: "Cancel run",
            verb: "Cancel",
            status: undefined,
            echo: "Cancel run: “fix flaky verify”",
        });
    });

    it("writes or picks first when the action takes a value", () => {
        const text: ThingAction<Job> = {
            ...plain,
            label: "Message the lead",
            input: { kind: "text", placeholder: "" },
        };
        expect(resolveActionRow(text, entry(true))).toMatchObject({
            title: "Message the lead…",
            verb: "Write",
            echo: "Takes the text here, for “fix flaky verify”",
        });
        const pick: ThingAction<Job> = {
            ...plain,
            label: "Stop a worker…",
            input: { kind: "pick", placeholder: "", options: () => [] },
        };
        expect(resolveActionRow(pick, entry(true))).toMatchObject({
            title: "Stop a worker…",
            verb: "Pick",
            echo: "Lists the choices, for “fix flaky verify”",
        });
    });

    it("lets a toggle read by the thing's current value", () => {
        const toggle: ThingAction<Job> = {
            ...plain,
            label: "Go autonomous",
            title: (j) => (j.live ? "Ask me again" : "Go autonomous"),
            verb: (j) => (j.live ? "Ask me" : "Go"),
            status: (j) => (j.live ? { label: "autonomous", tone: "accent" } : { label: "asks you", tone: "muted" }),
            echo: (j) => (j.live ? "asks again" : "answers everything"),
        };
        expect(resolveActionRow(toggle, entry(false))).toEqual({
            title: "Go autonomous",
            verb: "Go",
            status: { label: "asks you", tone: "muted" },
            echo: "answers everything",
        });
        expect(resolveActionRow(toggle, entry(true))).toEqual({
            title: "Ask me again",
            verb: "Ask me",
            status: { label: "autonomous", tone: "accent" },
            echo: "asks again",
        });
    });
});

describe("verbLeads", () => {
    it("matches when the query starts with the action's verb", () => {
        expect(verbLeads("cancel", "Cancel run")).toBe(true);
        expect(verbLeads("cancel flaky", "Cancel run")).toBe(true);
        expect(verbLeads("open dag", "Open the DAG")).toBe(true);
    });

    it("does not match a thing's name typed alone, so a name search is not buried in actions", () => {
        // a verb row's search text also holds the thing's title, which "flaky" would match
        expect(verbLeads("flaky", "Focus the cockpit on it")).toBe(false);
        expect(verbLeads("flaky", "Open in Jarvis")).toBe(false);
    });

    it("never matches an empty query", () => {
        expect(verbLeads("  ", "Cancel run")).toBe(false);
    });
});

describe("verbGroupLabel", () => {
    const row = (label: string) => ({ action: { label } });

    it("names the action when every row is the same one", () => {
        expect(verbGroupLabel([row("Cancel run"), row("Cancel run")])).toBe("Actions · Cancel run");
    });

    it("is plain Actions when the rows mix actions", () => {
        expect(verbGroupLabel([row("Cancel run"), row("Resume")])).toBe("Actions");
    });
});
