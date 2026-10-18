// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { backgroundActivity, shownState } from "./bgactivity";
import type { BackgroundTask } from "./transcriptprojection";

describe("backgroundActivity", () => {
    const task = (id: string, command: string, extra: Partial<BackgroundTask> = {}): BackgroundTask => ({
        toolUseId: id,
        label: command,
        command,
        status: "running",
        ...extra,
    });
    const build = task("b", "docker run --rm fit.py");
    const monitor = task("m", "tail -f fit.log | grep epoch", { monitor: true });
    const waitLoop = task("w", 'while true; do s=$(wsh agents list); [ "$s" = idle ] && break; sleep 20; done');

    it("is nothing when no background task runs", () => {
        expect(backgroundActivity(undefined, null)).toBeNull();
        expect(backgroundActivity([{ ...build, status: "completed" }], null)).toBeNull();
    });

    it("a command at work is working", () => {
        expect(backgroundActivity([build], null)).toBe("working");
    });

    it("a Monitor or a loop that sleeps between checks only waits", () => {
        expect(backgroundActivity([monitor], null)).toBe("waiting");
        expect(backgroundActivity([waitLoop], null)).toBe("waiting");
        expect(backgroundActivity([task("u", "until [ -f done.flag ]; do sleep 5; done")], null)).toBe("waiting");
        expect(backgroundActivity([task("a", "~/.arc/bin/wsh agents wait acaf10f7")], null)).toBe("waiting");
    });

    it("a loop that does not sleep is work", () => {
        expect(backgroundActivity([task("r", "while read f; do gzip $f; done < list")], null)).toBe("working");
    });

    it("work beside a watch is working", () => {
        expect(backgroundActivity([monitor, build], null)).toBe("working");
    });

    it("a dev server it left listening is neither: the agent is done and the server just runs", () => {
        const dev = task("d", "pnpm run dev", { outputFile: "/tmp/d.output" });
        const servers = [{ launchercmdline: "node /usr/local/bin/pnpm run dev" }];
        expect(backgroundActivity([dev], servers)).toBeNull();
        expect(backgroundActivity([dev, monitor], servers)).toBe("waiting");
        // before the server listens (or the first poll) it reads as work
        expect(backgroundActivity([dev], null)).toBe("working");
    });
});

describe("shownState", () => {
    it("an idle agent takes its background activity; a working or asking one keeps its state", () => {
        expect(shownState("idle", null)).toBe("idle");
        expect(shownState("idle", "working")).toBe("working");
        expect(shownState("idle", "waiting")).toBe("waiting");
        expect(shownState("working", "waiting")).toBe("working");
        expect(shownState("asking", "working")).toBe("asking");
    });
});
