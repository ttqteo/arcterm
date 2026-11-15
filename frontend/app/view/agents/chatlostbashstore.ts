// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The `!` commands sent from Chat, kept in localStorage (`chat.lostbash`) so one arcterm's restart cut short still draws
// after it (chatlostbash.ts holds the rules). Per viewer, and best effort: storage that is blocked or cleared only means
// such a command shows nothing, as before.

import { useEffect, useMemo } from "react";
import type { AgentEntry } from "./agentsviewmodel";
import { keepLostBash, lostBashOf, lostBashToDraw, pruneLostBash, type LostBash } from "./chatlostbash";

const KEY = "chat.lostbash";

// when this page loaded: a `!` sent since then still has its pending bubble, and only one sent before is drawn
const LOADED_AT = Date.now();

const NONE: LostBash[] = [];

function read(): readonly LostBash[] {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
        return Array.isArray(raw)
            ? raw.filter(
                  (r): r is LostBash =>
                      r != null &&
                      typeof r.session === "string" &&
                      typeof r.text === "string" &&
                      typeof r.sentAt === "number" &&
                      typeof r.seen === "number" &&
                      typeof r.after === "string"
              )
            : NONE;
    } catch {
        return NONE;
    }
}

function write(kept: readonly LostBash[]): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(kept));
    } catch (e) {
        console.warn("chat.lostbash: not kept", e);
    }
}

/** Keeps `text`, sent to the session whose transcript is `session`, when it is a `! cmd` (chatlostbash.ts lostBashOf). */
export function noteLostBash(session: string | undefined, text: string, entries: AgentEntry[]): void {
    const rec = lostBashOf(session ?? "", text, entries, Date.now());
    if (rec != null) {
        write(keepLostBash(read(), rec));
    }
}

/** The `!` commands of the session to draw as rows the restart cut short, and the records it no longer needs pruned. */
export function useLostBash(session: string | undefined, entries: AgentEntry[]): LostBash[] {
    // read once per transcript change: a record only matters while the page that loaded before it was written runs
    const kept = useMemo(() => (session ? read() : NONE), [session, entries]);
    useEffect(() => {
        if (!session || entries.length === 0) {
            return;
        }
        const next = pruneLostBash(kept, session, entries, Date.now());
        if (next !== kept) {
            write(next);
        }
    }, [kept, session, entries]);
    return useMemo(
        () => (session ? lostBashToDraw(kept, session, entries, LOADED_AT) : NONE),
        [kept, session, entries]
    );
}
