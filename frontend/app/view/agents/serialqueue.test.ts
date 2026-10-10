// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { serialQueue } from "./serialqueue";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("serialQueue", () => {
    it("starts an operation only once the one before it has finished", async () => {
        const queue = serialQueue();
        const log: string[] = [];
        let release: () => void = () => {};
        const first = queue(async () => {
            log.push("first start");
            await new Promise<void>((r) => (release = r));
            log.push("first end");
        });
        const second = queue(async () => {
            log.push("second");
        });
        await tick();
        expect(log).toEqual(["first start"]);
        release();
        await Promise.all([first, second]);
        expect(log).toEqual(["first start", "first end", "second"]);
    });
    it("hands each caller its own result", async () => {
        const queue = serialQueue();
        await expect(queue(async () => 7)).resolves.toBe(7);
    });
    it("keeps going after an operation fails, and the failure reaches only its caller", async () => {
        const queue = serialQueue();
        const failed = queue(async () => {
            throw new Error("boom");
        });
        const next = queue(async () => "ran");
        await expect(failed).rejects.toThrow("boom");
        await expect(next).resolves.toBe("ran");
    });
});
