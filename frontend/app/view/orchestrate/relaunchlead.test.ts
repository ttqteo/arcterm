// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { relaunchLeadAction } from "./relaunchlead";

function ev(kind: string, ts: number): RunEvent {
    return { id: `${kind}-${ts}`, runid: "run-1", channelid: "ch-1", ts, kind };
}

describe("relaunchLeadAction", () => {
    const failed = ev("lead-wake-failed", 10);

    it("offers the action on a lead-wake-failed row", () => {
        expect(relaunchLeadAction(failed, [failed], false)).toEqual({ disabled: false });
    });

    it("disables it while a relaunch is in flight", () => {
        expect(relaunchLeadAction(failed, [failed], true)).toEqual({ disabled: true });
    });

    it("offers nothing on any other row", () => {
        const woken = ev("lead-woken", 10);
        expect(relaunchLeadAction(woken, [woken, failed], false)).toBeNull();
    });

    it("withdraws the action once a lead has been started since the failure", () => {
        const launched = ev("lead-launched", 20);
        expect(relaunchLeadAction(failed, [failed, launched], false)).toBeNull();
    });

    it("withdraws the action once the lead is taking wakes again", () => {
        const revived = ev("lead-revived", 20);
        expect(relaunchLeadAction(failed, [failed, revived], false)).toBeNull();
    });

    it("keeps the action when the lead was started before the failure", () => {
        const launched = ev("lead-launched", 5);
        expect(relaunchLeadAction(failed, [launched, failed], false)).toEqual({ disabled: false });
    });
});
