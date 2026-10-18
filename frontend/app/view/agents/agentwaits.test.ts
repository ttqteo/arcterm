// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { waitMap, waitTarget } from "./agentwaits";
import type { BackgroundTask } from "./transcriptprojection";

describe("waitTarget", () => {
    const ids = ["acaf10f7-1111-4000-8000-000000000001", "092633ed-2222-4000-8000-000000000002", "b7e1c0de-3333"];
    const [target, self] = ids;
    const task = (command: string, extra: Partial<BackgroundTask> = {}): BackgroundTask => ({
        toolUseId: command,
        label: command,
        command,
        status: "running",
        ...extra,
    });

    it("reads the tab a `wsh agents wait` names, flags and a full path included", () => {
        expect(waitTarget([task("wsh agents wait acaf10f7")], self, ids)).toBe(target);
        expect(waitTarget([task("~/.arc/bin/wsh agents wait --timeout 2h acaf10f7")], self, ids)).toBe(target);
        expect(waitTarget([task(`wsh agents wait ${target}`)], self, ids)).toBe(target);
    });

    it("reads a watch loop or a Monitor that names another agent's tab id", () => {
        const loop = `prev=""; while true; do s=$(wsh agents list | awk '$1=="acaf10f7"{print $NF}'); sleep 20; done`;
        expect(waitTarget([task(loop)], self, ids)).toBe(target);
        expect(waitTarget([task("wsh agents read acaf10f7 | grep done", { monitor: true })], self, ids)).toBe(target);
    });

    it("an id in a command at work is no wait, nor is one that has finished", () => {
        expect(waitTarget([task("git show acaf10f7 > /tmp/x")], self, ids)).toBeNull();
        expect(waitTarget([task("wsh agents wait acaf10f7", { status: "completed" })], self, ids)).toBeNull();
    });

    it("never itself, no agent gone from the roster, and no prefix two agents share", () => {
        expect(waitTarget([task("wsh agents wait 092633ed")], self, ids)).toBeNull();
        expect(waitTarget([task("wsh agents wait ffff0000")], self, ids)).toBeNull();
        expect(waitTarget([task("wsh agents wait acaf")], self, [...ids, "acaf9999-0000"])).toBeNull();
    });
});

describe("waitMap", () => {
    it("maps each agent that waits to the agent it waits on", () => {
        const agents = [{ id: "aaaa1111-x" }, { id: "bbbb2222-y" }, { id: "cccc3333-z" }];
        const bg = {
            "bbbb2222-y": [
                { toolUseId: "t", label: "wait", command: "wsh agents wait aaaa1111", status: "running" as const },
            ],
        };
        expect([...waitMap(agents, bg)]).toEqual([["bbbb2222-y", "aaaa1111-x"]]);
    });
});
