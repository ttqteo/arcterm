// frontend/app/view/agents/changesstatus.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// What the Diff surface knows about a file list it is showing. A commit's change list used to be null
// for "not read yet" and also for "the read failed", so a failed read showed skeleton rows and
// `0 FILES +0 −0` for good. Both commit readers (githistorystore, comparestore) now keep this next to
// the list, so null changes never has to mean anything.

export type ChangesStatus = "loading" | "failed" | "ready";

// The DEV fault hook (window.__commitChangesFault) is read at the top of a commit's change read, by
// the history store and the compare store alike: "error" fails that one read, "hang" never answers it,
// and either clears itself. It lets the CDP scenario show the loading and failed states of the list.
export async function devCommitFault(): Promise<void> {
    if (!import.meta.env.DEV || typeof window === "undefined") {
        return;
    }
    const fault = window.__commitChangesFault;
    if (fault == null) {
        return;
    }
    window.__commitChangesFault = undefined;
    if (fault === "hang") {
        await new Promise<never>(() => {});
    }
    throw new Error("injected by __commitChangesFault");
}

declare global {
    interface Window {
        // DEV: "hang" holds the next commit change read forever, "error" fails it; cleared after one read
        __commitChangesFault?: "hang" | "error";
    }
}
