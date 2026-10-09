// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The inline rename editor of a session row (a tab). Shared by the Agent tree's agent rows and the rail's terminal
// rows: a session is a tab either way, so both rename through the same `session:label` meta.

import { globalStore } from "@/app/store/jotaiStore";
import { useEffect, useRef, useState } from "react";
import { renamingRowAtom } from "./rowrenameatom";
import { renameSession, sessionCustomLabel } from "./session-models/sessionsidebarmodel";
import { labelChanged } from "./session-models/sessionviewmodel";

export function startRowRename(tabId: string): void {
    globalStore.set(renamingRowAtom, tabId);
}

// Scoped to one row on purpose: starting a rename on a second row has already moved the atom, and the
// first box unmounting must not then cancel the box that replaced it.
function endRowRename(tabId: string): void {
    if (globalStore.get(renamingRowAtom) === tabId) {
        globalStore.set(renamingRowAtom, null);
    }
}

// Mounted in place of the row's name while renaming, which is why the seed is read on mount: this component's
// whole lifetime IS the edit. It opens on the name the row shows (its own label, else the auto name `shown`), all of it
// selected: typing replaces it, an arrow key edits it, and an emptied box goes back to the auto name.
export function RenameBox({ tabId, shown }: { tabId: string; shown: string }) {
    const [initial] = useState(() => sessionCustomLabel(tabId) || shown);
    const [draft, setDraft] = useState(initial);
    // Enter and blur both mean commit and Escape means cancel, but removing a focused input also
    // fires blur — so without this latch, cancelling would immediately commit the draft it discarded.
    const settled = useRef(false);
    const finish = (save: boolean) => {
        if (settled.current) {
            return;
        }
        settled.current = true;
        if (save && labelChanged(draft, initial)) {
            renameSession(tabId, draft);
        }
        endRowRename(tabId);
    };
    // The row can vanish under an open box — its session closed, or the agent exited — and React does
    // not deliver blur to an unmounting input. Without this the atom would keep naming a dead tab and
    // the Escape guard in bindings.ts would go on yielding to a box nobody can see.
    useEffect(() => () => endRowRename(tabId), [tabId]);
    return (
        <input
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            value={draft}
            // the row itself is a click target (select/focus); a click meant for the caret is not one
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    finish(true);
                }
                if (e.key === "Escape") {
                    e.preventDefault();
                    finish(false);
                }
            }}
            onBlur={() => finish(true)}
            placeholder="Name this session"
            aria-label="Session name"
            className="w-full min-w-0 rounded-[5px] border border-accent bg-surface px-[5px] text-[13px] font-medium text-primary focus:outline-none"
        />
    );
}
