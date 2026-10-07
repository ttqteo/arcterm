// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// New initiative: the app's only way to start an effort from the UI. EffortCreateForm has been complete and
// working the whole time — it lost its only mount when B5 deleted effortslistview.tsx, so the Brief listed
// initiatives it could not start one of. This is the mount, next to + Channel, because those are the two
// things the Brief can begin. The ⇧N binding presses it by data attribute (buildJarvisBindings), the same
// way `c` presses + Channel.
//
// The open state is model.newInitiativeOpenAtom and the form is mounted by NewInitiativeHost in the cockpit
// root, not beside the button: the palette opens it from any surface, and the Brief (the button's only
// mount) unmounts on a switch away.

import { globalStore } from "@/app/store/jotaiStore";
import { formatChordString } from "@/util/keysym";
import { useAtomValue } from "jotai";
import type { AgentsViewModel } from "../agents/agents";
import { EffortCreateForm } from "./effortcreateform";

export function NewInitiativeControl({ model }: { model: AgentsViewModel }) {
    const open = useAtomValue(model.newInitiativeOpenAtom);
    return (
        <button
            type="button"
            data-jarvis-new-initiative
            aria-expanded={open}
            onClick={() => globalStore.set(model.newInitiativeOpenAtom, true)}
            className="flex h-[28px] flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-edge-mid px-2.5 text-[12px] font-semibold text-secondary hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            New initiative
            <kbd className="font-mono text-[10px] font-normal text-muted">{formatChordString("Shift:n")}</kbd>
        </button>
    );
}

export function NewInitiativeHost({ model }: { model: AgentsViewModel }) {
    const open = useAtomValue(model.newInitiativeOpenAtom);
    return open ? <EffortCreateForm onClose={() => globalStore.set(model.newInitiativeOpenAtom, false)} /> : null;
}
