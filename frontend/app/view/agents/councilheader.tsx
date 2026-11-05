// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The one header row of a council's three views, the Report, the Discussion and the Map (CouncilHeaderRow): the tabs
// (counciltabs.tsx), the title, the step chip, then the seats' stack and the actions menu (…), one 44px line that never
// wraps and sits in the same place on every tab, so a tab click moves nothing in it. Only the title shrinks: it truncates
// (the whole is its hover) before anything leaves the row. The Report adds its details after the chip (the mode, the
// clock, the replies and the tokens: councildetails.tsx CouncilDetailsLine) and its jump links before the seats; the
// Discussion keeps its details at the foot of its Ideas rail, and the Map shows none. The actions menu holds what the
// view offers (the Discussion's Summarize, the Report's document and initiative rows), then Resume and Pin, then Stop
// on its own past a separator; it is the app's one context menu, opened under the button.

import { contextMenuAtom } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Ellipsis, Pin, PinOff, Play } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { chipShort, stepChip } from "./councilchatmodel";
import { CouncilDetailsLine } from "./councildetails";
import { isPinnedCouncil } from "./councilmodel";
import { resumeCouncil, useCanResumeCouncil } from "./councilresume";
import { CouncilSeats } from "./councilseats";
import { setCouncilPinned } from "./councilstore";
import { CouncilTabs } from "./counciltabs";
import type { CouncilTabId } from "./counciltabsmodel";

// a bare icon that takes a fill on hover, as the agent header's
const ICON_BTN =
    "flex flex-none cursor-pointer items-center justify-center rounded-[6px] border border-transparent p-[5px] text-muted outline-none hover:bg-surface-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-accent";

/** The actions menu (…): the view's own `items` first, then Resume (when the tree no longer lists the council) and Pin
 *  or Unpin, then `stop` past a separator. Each row carries a data attribute (`data-council-summarize`, …-resume, …-pin,
 *  …-stop) a CDP scenario finds it by once the menu is open. */
export function CouncilActions({
    c,
    items,
    stop,
    className,
}: {
    c: Council;
    items?: ContextMenuItem[];
    stop?: ContextMenuItem;
    className?: string;
}) {
    const canResume = useCanResumeCouncil(c);
    const pinned = isPinnedCouncil(c);
    // the one context menu may be another control's, so open means it holds the items this button showed
    const shown = useRef<ContextMenuItem[] | null>(null);
    const openMenu = useAtomValue(contextMenuAtom);
    const open = shown.current != null && openMenu?.items === shown.current;
    const menu: ContextMenuItem[] = [...(items ?? [])];
    if (canResume) {
        menu.push({
            label: "Resume",
            icon: <Play />,
            title: "Put this council back in the tree and open its Discussion: nothing runs until you reply",
            click: () => resumeCouncil(c.id),
            attrs: { "data-council-resume": "" },
        });
    }
    menu.push({
        label: pinned ? "Unpin" : "Pin",
        icon: pinned ? <PinOff /> : <Pin />,
        title: pinned
            ? "Unpin: the tree stops keeping this council on top"
            : "Keep this council at the top of its project in the tree",
        click: () => void setCouncilPinned(c.id, !pinned),
        attrs: { "data-council-pin": pinned ? "pinned" : "pin" },
    });
    if (stop != null) {
        menu.push({ type: "separator" }, stop);
    }
    const words = menu.filter((item) => item.label != null).map((item) => item.label);
    return (
        <button
            type="button"
            data-council-actions
            data-pinned={pinned ? "true" : "false"}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Council actions"
            title={`More: ${words.join(", ")}`}
            onClick={(e) => {
                // opened under the button, not at the pointer, so Enter on it drops the menu in the same place
                const r = e.currentTarget.getBoundingClientRect();
                shown.current = menu;
                globalStore.set(contextMenuAtom, { x: r.left, y: r.bottom + 2, items: menu });
            }}
            className={cn(ICON_BTN, open && "bg-surface-hover text-primary", className)}
        >
            <Ellipsis size={15} strokeWidth={1.8} aria-hidden />
        </button>
    );
}

// the step chip's colours by its dot: amber while the council waits on the person, green while it runs, red when it failed
const CHIP_TONE = {
    working: { box: "bg-pill text-secondary", dot: "bg-working pulse-dot" },
    waiting: { box: "bg-askingbg text-warning-soft", dot: "bg-asking" },
    failed: { box: "bg-error/12 text-error-soft", dot: "bg-error" },
    idle: { box: "bg-pill text-secondary", dot: "bg-ink-faint" },
};

// the step in its short words (`Round 1/2`), whole: the title truncates before it would shrink. The full words are its
// hover and what a screen reader hears (and what `data-council-chip` reads)
function StatusChip({ c }: { c: Council }) {
    const chip = stepChip(c);
    const tone = CHIP_TONE[chip.dot];
    return (
        <span
            title={chip.text}
            className={cn(
                "inline-flex flex-none items-center gap-[5px] whitespace-nowrap rounded-full px-[7px] py-[2px] text-[10.5px] tabular-nums",
                tone.box
            )}
        >
            <span aria-hidden className={cn("h-[6px] w-[6px] flex-none rounded-full", tone.dot)} />
            <span aria-hidden>{chipShort(chip.text)}</span>
            <span data-council-chip aria-live="polite" className="sr-only">
                {chip.text}
            </span>
        </span>
    );
}

/** A council view's header row. `titleAttr` is the title's data attribute (each view's scenarios read their own);
 *  `details` draws the details after the step chip (the Report's); `aside` sits before the seats (the Report's jump
 *  links); `onCurrent` runs on a click of the tab already shown (CouncilTabs). */
export function CouncilHeaderRow({
    c,
    view,
    titleAttr,
    details = false,
    aside,
    items,
    stop,
    onCurrent,
    onOpenTerminal,
}: {
    c: Council;
    view: CouncilTabId;
    titleAttr: `data-${string}`;
    details?: boolean;
    aside?: ReactNode;
    items?: ContextMenuItem[];
    stop?: ContextMenuItem;
    onCurrent?: () => void;
    onOpenTerminal: (tab: string) => void;
}) {
    return (
        <div className="flex h-[44px] min-w-0 items-center gap-[10px] px-5 @max-[900px]:gap-2 @max-[900px]:px-[14px]">
            <CouncilTabs c={c} view={view} onCurrent={onCurrent} />
            <div aria-hidden className="h-5 w-px flex-none bg-edge-mid" />
            <h1
                {...{ [titleAttr]: "" }}
                title={c.feature}
                // shrinks far ahead of everything else in the row
                className="m-0 min-w-[60px] flex-[0_1000_auto] truncate text-[14px] font-semibold tracking-[-0.01em] text-primary"
            >
                {c.feature}
            </h1>
            <StatusChip c={c} />
            {details && <CouncilDetailsLine c={c} />}
            <div className="min-w-3 flex-1" />
            {aside}
            <CouncilSeats c={c} onOpenTerminal={onOpenTerminal} />
            <CouncilActions c={c} items={items} stop={stop} />
        </div>
    );
}
