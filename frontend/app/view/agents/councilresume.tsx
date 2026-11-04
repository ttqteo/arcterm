// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Resume a council the Agent tree no longer lists (canResumeCouncil: it ran and ended, a day ago or closed since), as an
// ended agent session is resumed: it comes back to its project's folder in the tree for a day (councilopened.ts'
// resumed map, kept per browser) and opens on its Discussion with the channel's box focused. Nothing runs and no model
// is called: the person's reply there starts the follow-up round with the same panel. A row of the actions menu (…) in
// each of the council's views (councilheader.tsx); Councils' rows offer the same action.

import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { showCouncil } from "./agentcenter";
import { canResumeCouncil } from "./agentsidebarmodel";
import { councilOpenedAtom, markCouncilResumed } from "./councilopened";
import { projectsAtom } from "./projectsstore";

// how many frames to wait for the Discussion's box to mount after the switch
const FOCUS_TRIES = 20;

function focusChannelBox(tries = FOCUS_TRIES): void {
    const box = document.querySelector<HTMLTextAreaElement>(
        '[data-council-composer="channel"] [data-council-composer-input]'
    );
    if (box != null) {
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
        return;
    }
    if (tries > 0) {
        requestAnimationFrame(() => focusChannelBox(tries - 1));
    }
}

/** Resume council `id`: back in the tree for a day, opened on its Discussion with the box focused. Runs nothing. */
export function resumeCouncil(id: string): void {
    markCouncilResumed(id);
    showCouncil(id, "discussion");
    requestAnimationFrame(() => focusChannelBox());
}

/** Whether council `c` offers Resume: the Agent tree no longer lists it and has a folder for its project. */
export function useCanResumeCouncil(c: Council): boolean {
    const opened = useAtomValue(councilOpenedAtom);
    const registered = useAtomValue(projectsAtom);
    // project name -> root path, as the tree builds it, so Resume shows only where the tree has a folder for it
    const roots = useMemo(() => {
        const out = new Map<string, string>();
        for (const [name, project] of Object.entries(registered ?? {})) {
            if (project?.path) {
                out.set(name, project.path);
            }
        }
        return out;
    }, [registered]);
    return canResumeCouncil(c, opened, Date.now(), roots);
}
