// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { buildLaunchItems, type LaunchDeps } from "./palette-launch";

function mkDeps(): LaunchDeps & { open: ReturnType<typeof vi.fn>; consult: ReturnType<typeof vi.fn> } {
    return { open: vi.fn(), consult: vi.fn() } as any;
}

describe("buildLaunchItems", () => {
    it("returns [] with no goal", () => {
        expect(buildLaunchItems("   ", "payments-api", mkDeps())).toEqual([]);
    });
    it("produces the keyed rows in order, Quick first", () => {
        const items = buildLaunchItems("fix auth", "payments-api", mkDeps());
        expect(items.map((i) => i.key)).toEqual([
            "launch:quick",
            "launch:orchestrate",
            "launch:consult:claude",
            "launch:consult:pi",
        ]);
    });
    // the New run window picks the project, so no project is not a dead end; an ask posts into a
    // project's channel, so it is
    it("offers the run rows but no ask rows with no project", () => {
        const items = buildLaunchItems("fix auth", undefined, mkDeps());
        expect(items.map((i) => i.key)).toEqual(["launch:quick", "launch:orchestrate"]);
        expect(items[1].echo).toBe("Opens the New run window with “fix auth” as an orchestrator run");
    });

    it("opens the New run window instead of starting a run, so the project is settled there", () => {
        const deps = mkDeps();
        const items = buildLaunchItems("  fix auth  ", "ch", deps);
        items.find((i) => i.key === "launch:quick")!.run();
        items.find((i) => i.key === "launch:orchestrate")!.run();
        expect(deps.open).toHaveBeenNthCalledWith(1, "fix auth", "quick");
        expect(deps.open).toHaveBeenNthCalledWith(2, "fix auth", "orchestrator");
        expect(deps.consult).not.toHaveBeenCalled();
    });

    it("orchestrates from any other row of the block on Ctrl+Enter", () => {
        const deps = mkDeps();
        const items = buildLaunchItems("  fix auth  ", "ch", deps);
        const others = items.filter((i) => i.key !== "launch:orchestrate");
        expect(others.every((i) => i.alt != null)).toBe(true);
        items.find((i) => i.key === "launch:consult:pi")!.alt!.run();
        expect(deps.open).toHaveBeenCalledWith("fix auth", "orchestrator");
        expect(deps.consult).not.toHaveBeenCalled();
        expect(items.find((i) => i.key === "launch:orchestrate")!.chord).toBe("Mod:Enter");
    });

    it("consults claude and pi with the trimmed goal", () => {
        const deps = mkDeps();
        const items = buildLaunchItems("  fix auth  ", "ch", deps);
        items.find((i) => i.key === "launch:consult:claude")!.run();
        items.find((i) => i.key === "launch:consult:pi")!.run();
        expect(deps.consult).toHaveBeenNthCalledWith(1, "claude", "fix auth");
        expect(deps.consult).toHaveBeenNthCalledWith(2, "pi", "fix auth");
        expect(deps.open).not.toHaveBeenCalled();
    });

    it("says what each row does, with the verb Enter shows", () => {
        const items = buildLaunchItems("g", "ch", mkDeps());
        expect(items.map((i) => i.verb)).toEqual(["Open", "Open", "Ask", "Ask"]);
        expect(items[1].echo).toBe("Opens the New run window with “g” as an orchestrator run, #ch preselected");
        expect(items[3].echo).toBe("Asks pi about “g”, nothing is spawned");
    });
});
