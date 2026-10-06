import type { AgentsViewModel } from "@/app/view/agents/agents";
import { taskListAtom } from "@/app/view/jarvis/tasksstore";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { RECORD_KIND } from "./record";

const rec = (over: Partial<SpaceSummary> = {}): SpaceSummary => ({
    id: "d1",
    objective: "ship it",
    ticket: "",
    status: "active",
    updated: 0,
    ...over,
});
const action = (id: string) => RECORD_KIND.actions.find((a) => a.id === id)!;
const model = {} as AgentsViewModel;

describe("record actions", () => {
    it("change status offers the peek's legal transitions, never the current status", () => {
        const status = action("record:status");
        expect(status.applies(rec())).toBe(true);
        expect(status.input?.kind).toBe("pick");
        const options = status.input?.kind === "pick" ? status.input.options(rec({ status: "completed" })) : [];
        // allowedTransitions forbids paused-from-completed
        expect(options.map((o) => o.value)).toEqual(["active", "archived"]);
    });
    it("change status does not apply to a status with no legal transition", () => {
        expect(action("record:status").applies(rec({ status: "bogus" }))).toBe(false);
    });
    it("open always applies", () => {
        expect(action("record:open").applies(rec({ status: "archived" }))).toBe(true);
    });
});

describe("record entries", () => {
    it("keys every record, archived included, as the palette row", () => {
        const store = createStore();
        store.set(taskListAtom, [rec(), rec({ id: "d2", objective: "", status: "archived" })]);
        const entries = RECORD_KIND.entries(store.get, model);
        expect(entries.map((e) => e.key)).toEqual(["record:d1", "record:d2"]);
        expect(entries.map((e) => e.title)).toEqual(["ship it", "(untitled record)"]);
    });
    it("lists nothing before the list loads", () => {
        expect(RECORD_KIND.entries(createStore().get, model)).toEqual([]);
    });
});
