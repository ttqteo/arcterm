// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The model of the usage refresh button (Plan usage strip, Usage surface): when it is offered, and what a
// refused ask tells the user. See 2026-10-07-claude-account-switch-design.md (decision 10).

// The button asks for Claude's windows, which the usage endpoint gives only for the Default account: it is
// offered when a claude window is shown, or Default is active (where it is how the first reading arrives).
// `shownProviders` are the providers whose windows the surface shows; `activeAccount` is "" for Default.
export function showUsageRefresh(shownProviders: string[], activeAccount: string): boolean {
    return activeAccount === "" || shownProviders.includes("claude");
}

// What a 429 backoff says, with `retryAt` an epoch ms.
export function retryHint(retryAt: number): string {
    const at = new Date(retryAt);
    const two = (n: number) => String(n).padStart(2, "0");
    return `thử lại lúc ${two(at.getHours())}:${two(at.getMinutes())}`;
}
