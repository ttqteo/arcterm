// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { describe, expect, it } from "vitest";
import {
    bumpWaking,
    failureOfSleep,
    isWaking,
    setWakeFailure,
    wakeFailuresAtom,
    wakingAtom,
    whileWaking,
    withWakeDraft,
} from "./wakingstore";

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

describe("withWakeDraft", () => {
    it("keeps each agent's draft apart and drops an emptied one", () => {
        let m = withWakeDraft(new Map(), "a", "push the docs");
        m = withWakeDraft(m, "b", "hi");
        expect(m.get("a")).toBe("push the docs");
        m = withWakeDraft(m, "a", "");
        expect(m.has("a")).toBe(false);
        expect(m.get("b")).toBe("hi");
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

describe("wake failures", () => {
    it("keeps the reason of a failed wake and drops it on success", () => {
        setWakeFailure("t3", "the session file is gone");
        expect(globalStore.get(wakeFailuresAtom).get("t3")?.reason).toBe("the session file is gone");
        setWakeFailure("t3", null);
        expect(globalStore.get(wakeFailuresAtom).has("t3")).toBe(false);
    });

    it("ties a failure to the sleep it came from", () => {
        const f = { at: 2_000, reason: "gone" };
        expect(failureOfSleep(f, 1_000)).toBe("gone");
        // a later sleep of the same agent does not show the old failure
        expect(failureOfSleep(f, 3_000)).toBeUndefined();
        expect(failureOfSleep(undefined, 1_000)).toBeUndefined();
    });
});
