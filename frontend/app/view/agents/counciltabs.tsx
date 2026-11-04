// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Report / Discussion / Map tab strip of a council, shared by the three views (councilsummary.tsx,
// councildiscussion.tsx, councilmap.tsx): the tab shown is underlined in the primary colour, a click on another one opens
// it (showCouncil), a click on the one shown runs the view's `onCurrent` (the Report glides down to its body), and the Discussion tab carries the count of ideas sent (counciltabsmodel.ts). The Map's word follows
// the council's language. The parent row sets the height; each tab fills it. Under 900px of pane (the nearest `@container`:
// each header sets one) the tabs go icon-only: the word is kept for a screen reader beside the icon, and a tab's title and
// aria-label say it (with the count), so Vietnamese's longer words never crowd the row. The Discussion's count stays, since it
// fits beside an icon.

import { cn } from "@/util/util";
import { FileText, LayoutGrid, MessagesSquare, type LucideIcon } from "lucide-react";
import { showCouncil } from "./agentcenter";
import { councilTabs, type CouncilTabId } from "./counciltabsmodel";

const TAB =
    "flex h-full items-center gap-[7px] border-b-2 px-[2px] text-[13.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent @max-[900px]:px-[6px]";

const ICON: Record<CouncilTabId, LucideIcon> = { summary: FileText, discussion: MessagesSquare, map: LayoutGrid };

export function CouncilTabs({
    c,
    view,
    onCurrent,
    className,
}: {
    c: Council;
    view: CouncilTabId;
    // a click on the tab already shown (the Report scrolls down to its body); without it that tab does nothing
    onCurrent?: () => void;
    className?: string;
}) {
    return (
        <div role="tablist" aria-label="Council view" className={cn("flex items-stretch gap-5", className)}>
            {councilTabs(c).map((tab) => {
                const Icon = ICON[tab.id];
                return (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={view === tab.id}
                        data-council-tab={tab.id}
                        title={tab.label}
                        aria-label={tab.count !== "" ? `${tab.label} ${tab.count}` : tab.label}
                        className={cn(
                            TAB,
                            view === tab.id
                                ? cn("border-primary font-semibold text-primary", onCurrent != null && "cursor-pointer")
                                : "cursor-pointer border-transparent font-medium text-secondary hover:text-primary"
                        )}
                        onClick={() => {
                            if (view !== tab.id) {
                                showCouncil(c.id, tab.id);
                            } else {
                                onCurrent?.();
                            }
                        }}
                    >
                        <Icon size={14} aria-hidden />
                        <span data-council-tab-label className="@max-[900px]:sr-only">
                            {tab.label}
                        </span>
                        {tab.count !== "" && (
                            <span
                                data-council-tab-count
                                className="rounded-full bg-pill px-[7px] py-px text-[12px] font-medium text-muted tabular-nums"
                            >
                                {tab.count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
