// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { describe, expect, it } from "vitest";
import { bumpWaking, isWaking, wakingAtom, whileWaking } from "./wakingstore";

describe("bumpWaking", () => {
    it("counts two wakes of one agent and drops it at zero", () => {
        let m = bumpWaking(new Map(), "a", 1);
        m = bumpWaking(m, "a", 1);
        expect(m.get("a")).toBe(2);
        m = bumpWaking(m, "a", -1);
        expect(m.get("a")).toBe(1);
        m = bumpWaking(m, "a", -1);
        expect(m.has("a")).toBe(false);
    });
});

describe("whileWaking", () => {
    it("marks the agent waking for as long as the call runs, failed or not", async () => {
        let release!: () => void;
        const call = whileWaking("t1", () => new Promise<void>((r) => (release = r)));
        expect(isWaking("t1")).toBe(true);
        release();
        await call;
        expect(isWaking("t1")).toBe(false);

        await expect(whileWaking("t2", () => Promise.reject(new Error("no session")))).rejects.toThrow("no session");
        expect(globalStore.get(wakingAtom).has("t2")).toBe(false);
    });
});
