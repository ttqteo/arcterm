// frontend/app/view/code/codestalebar.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// "The file you are reading changed on disk" is information, not an annoyance to hide — agents run
// against this same working tree. Reload is always deliberate, and when a draft exists the button
// says what it destroys, matching the save-conflict banner's honesty. With a draft, Compare with disk
// shows what the reload would throw away before anyone chooses it.

import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { codeDraftsAtom, codeProjectAtom, codeStaleAtom, compareWithDisk, draftKey, reloadFromDisk } from "./codestore";

export function CodeStaleBar() {
    const stale = useAtomValue(codeStaleAtom);
    const project = useAtomValue(codeProjectAtom);
    const drafts = useAtomValue(codeDraftsAtom);
    if (stale == null || project == null) {
        return null;
    }
    const dirty = drafts.has(draftKey(project, stale.path));
    return (
        <div
            data-code-stale
            className="flex flex-none items-center gap-3 border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-[11.5px] text-warning"
        >
            <span className="min-w-0 flex-1 truncate">
                {stale.path} changed on disk{dirty ? " — your unsaved edits are still here" : ""}
            </span>
            <button
                type="button"
                onClick={() => fireAndForget(reloadFromDisk)}
                className="flex-none cursor-pointer rounded-[6px] border border-warning/40 px-2 py-[2px] font-semibold hover:bg-warning/15"
            >
                {dirty ? "Discard my edits and reload" : "Reload"}
            </button>
            {dirty ? (
                <button
                    type="button"
                    onClick={compareWithDisk}
                    className="flex-none cursor-pointer rounded-[6px] border border-warning/40 px-2 py-[2px] hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    Compare with disk
                </button>
            ) : null}
        </div>
    );
}
