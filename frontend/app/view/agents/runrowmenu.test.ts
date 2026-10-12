import type { RunThing } from "@/app/cockpit/actions/run";
import type { ThingAction } from "@/app/cockpit/actions/types";
import { describe, expect, it } from "vitest";
import { runMenuEntries } from "./runrowmenu";

const thing = { channelId: "c1", liveCount: 2 } as unknown as RunThing;

function action(id: string, extra: Partial<ThingAction<RunThing>> = {}): ThingAction<RunThing> {
    return { id, label: id, group: "open", applies: () => true, run: () => {}, ...extra };
}

describe("runMenuEntries", () => {
    it("keeps the applicable actions in registry order, less the skipped ones", () => {
        const entries = runMenuEntries(
            [action("run:open"), action("run:dag"), action("run:diff", { applies: () => false }), action("run:cancel")],
            thing,
            new Set(["run:open"])
        );
        expect(entries.map((e) => e.action.id)).toEqual(["run:dag", "run:cancel"]);
        expect(entries.every((e) => e.kind === "action")).toBe(true);
    });

    it("turns a pick into a submenu of its options and leaves a typed input out", () => {
        const entries = runMenuEntries(
            [
                action("run:workers", {
                    input: { kind: "pick", placeholder: "", options: () => [{ value: "1", label: "1 at a time" }] },
                }),
                action("run:message", { input: { kind: "text", placeholder: "" } }),
            ],
            thing,
            new Set()
        );
        expect(entries).toEqual([
            expect.objectContaining({ kind: "pick", options: [{ value: "1", label: "1 at a time" }] }),
        ]);
    });

    it("drops a pick with nothing to pick", () => {
        const entries = runMenuEntries(
            [action("run:stop-worker", { input: { kind: "pick", placeholder: "", options: () => [] } })],
            thing,
            new Set()
        );
        expect(entries).toEqual([]);
    });
});
