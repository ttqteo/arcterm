// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The `[close]` lines the cockpit writes to waveapp.log whenever a tab closes, so a tab that closed with nobody
// remembering closing it can be traced: which route closed it (a button, a key, a menu, a store's own cleanup) and,
// for a close that asked first, whether the confirm came from Enter or a click and how soon after the dialog opened
// (an Enter a few hundred ms after the dialog opened is a keystroke meant for something else). Pure: the caller sends
// the line (closetab.ts).

// How a confirm dialog was accepted: the key or the click, and the ms since the dialog opened.
export interface ConfirmHow {
    via: "enter" | "click";
    afterMs: number;
}

export type CloseEvent =
    // a close that asks first showed its dialog
    | { kind: "ask"; tabId: string; name: string; from: string }
    // that dialog was accepted
    | { kind: "confirm"; tabId: string; name: string; from: string; how?: ConfirmHow }
    // a tab is being closed (every route ends here)
    | { kind: "close"; tabId: string; why: string };

function quote(s: string): string {
    return JSON.stringify(s);
}

function tabShort(tabId: string): string {
    return tabId.slice(0, 8);
}

export function closeLogLine(e: CloseEvent): string {
    switch (e.kind) {
        case "ask":
            return `[close] ask tab=${tabShort(e.tabId)} name=${quote(e.name)} from=${e.from || "?"}`;
        case "confirm": {
            const how = e.how == null ? "" : ` via=${e.how.via} after=${Math.max(0, Math.round(e.how.afterMs))}ms`;
            return `[close] confirm tab=${tabShort(e.tabId)} name=${quote(e.name)} from=${e.from || "?"}${how}`;
        }
        case "close":
            return `[close] close tab=${tabShort(e.tabId)} why=${e.why || "?"}`;
    }
}
