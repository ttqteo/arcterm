// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Report / Discussion / Map switch of a council, shared by the three views (councilsummary.tsx,
// councildiscussion.tsx, councilmap.tsx): three icon buttons in one segmented box, the one shown on a grey fill. A click
// on another opens it (showCouncil), a click on the one shown runs the view's `onCurrent` (the Report glides down to its
// body). Each tab's word is its title and aria-label, and a screen reader's text beside the icon, so the row stays short
// in any language (Vietnamese's Bản đồ included); the Discussion's carries the number of ideas sent beside its icon, the
// words in its aria-label (counciltabsmodel.ts).

import { cn } from "@/util/util";
import { FileText, LayoutGrid, MessagesSquare, type LucideIcon } from "lucide-react";
import { showCouncil } from "./agentcenter";
import { councilTabs, type CouncilTabId } from "./counciltabsmodel";

const BOX = "flex flex-none items-center gap-[2px] rounded border border-border bg-surface-raised p-[3px]";

const TAB =
    "flex h-[24px] items-center gap-[6px] rounded-sm border-0 px-[8px] outline-none focus-visible:ring-2 focus-visible:ring-accent";

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
        <div role="tablist" aria-label="Council view" className={cn(BOX, className)}>
            {councilTabs(c).map((tab) => {
                const Icon = ICON[tab.id];
                const on = view === tab.id;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        data-council-tab={tab.id}
                        title={tab.label}
                        aria-label={tab.count !== "" ? `${tab.label} ${tab.count}` : tab.label}
                        className={cn(
                            TAB,
                            on
                                ? cn(
                                      "bg-surface-selected text-primary",
                                      onCurrent != null ? "cursor-pointer" : "cursor-default"
                                  )
                                : "cursor-pointer bg-transparent text-muted hover:text-primary"
                        )}
                        onClick={() => {
                            if (!on) {
                                showCouncil(c.id, tab.id);
                            } else {
                                onCurrent?.();
                            }
                        }}
                    >
                        <Icon size={14} aria-hidden />
                        <span data-council-tab-label className="sr-only">
                            {tab.label}
                        </span>
                        {tab.badge !== "" && (
                            <span data-council-tab-count className="text-[11.5px] font-semibold tabular-nums">
                                {tab.badge}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
