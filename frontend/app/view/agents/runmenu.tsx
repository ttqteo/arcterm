// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A run's ⋯ menu: Pause while the run can be paused, Resume while it is paused (runmenumodel.ts says which). One button
// for the run sheet's header, the lead card and the DAG header, so a run reads the same wherever it is acted on. The menu
// is the app's context menu, opened under the button; Cancel stays its own button beside it, never an item in here.

import { closeContextMenu, contextMenuAtom } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Ellipsis, Pause, Play } from "lucide-react";
import { useRef } from "react";
import { pauseRun, pausingRunIdsAtom, resumePausedRun, resumingRunIdsAtom } from "./runactions";
import { runMenuChoices, type RunMenuKey, type RunMenuRun } from "./runmenumodel";

const BUTTON =
    "flex h-[23px] w-[25px] flex-none cursor-pointer items-center justify-center rounded-[6px] border border-edge-mid text-secondary hover:border-edge-strong hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// the menu dismisses on a press outside it, so a press on the button that closed it is followed by a click that would
// open it again. A click this soon after such a press is the close; a later one is a new open.
const PRESS_TO_CLICK_MS = 1000;

const ACTION: Record<
    RunMenuKey,
    {
        icon: React.ReactNode;
        attrs: ContextMenuItem["attrs"];
        call: (channelId: string, runId: string) => Promise<void>;
    }
> = {
    pause: { icon: <Pause />, attrs: { "data-run-menu-pause": "" }, call: pauseRun },
    resume: { icon: <Play />, attrs: { "data-run-menu-resume": "" }, call: resumePausedRun },
};

export function RunMenu({
    channelId,
    runId,
    run,
    className,
}: {
    channelId: string;
    runId: string;
    run: RunMenuRun;
    className?: string;
}) {
    // the one context menu may be another control's, so open means it holds the items this button showed
    const shown = useRef<ContextMenuItem[] | null>(null);
    const pressClosedAt = useRef(-Infinity);
    const openMenu = useAtomValue(contextMenuAtom);
    const pausing = useAtomValue(pausingRunIdsAtom).has(runId);
    const resuming = useAtomValue(resumingRunIdsAtom).has(runId);
    const open = shown.current != null && openMenu?.items === shown.current;
    const choices = runMenuChoices(run, { pausing, resuming });
    if (choices.length === 0) {
        return null;
    }
    const items = choices.map(
        (c): ContextMenuItem => ({
            label: c.label,
            title: c.title,
            enabled: c.enabled,
            icon: ACTION[c.key].icon,
            attrs: ACTION[c.key].attrs,
            click: () => fireAndForget(() => ACTION[c.key].call(channelId, runId)),
        })
    );
    const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        // a lead card selects itself on a click anywhere in it
        e.stopPropagation();
        if (performance.now() - pressClosedAt.current < PRESS_TO_CLICK_MS) {
            pressClosedAt.current = -Infinity;
            return;
        }
        // a click with no press before it (the keyboard) while the menu is open
        if (shown.current != null && globalStore.get(contextMenuAtom)?.items === shown.current) {
            closeContextMenu();
            return;
        }
        const button = e.currentTarget;
        const r = button.getBoundingClientRect();
        shown.current = items;
        globalStore.set(contextMenuAtom, { x: r.left, y: r.bottom + 2, items });
        // armed before the menu mounts its own outside-press dismissal, so it sees the press while the menu is open
        document.addEventListener(
            "pointerdown",
            (ev) => {
                if (globalStore.get(contextMenuAtom)?.items === items && button.contains(ev.target as Node)) {
                    pressClosedAt.current = performance.now();
                }
            },
            { capture: true, once: true }
        );
    };
    return (
        <button
            type="button"
            data-run-menu
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Run actions"
            title={`More: ${choices.map((c) => c.label).join(", ")}`}
            onClick={onClick}
            className={cn(BUTTON, open && "bg-surface-hover text-primary", className)}
        >
            <Ellipsis size={15} strokeWidth={1.8} aria-hidden />
        </button>
    );
}
