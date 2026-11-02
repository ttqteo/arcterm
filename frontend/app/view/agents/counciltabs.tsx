// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Report / Discussion tab strip of a council, shared by both views (councilsummary.tsx, councildiscussion.tsx):
// the tab shown is underlined in the primary colour, a click on the other one opens it (showCouncil), and the
// Discussion tab carries the count of ideas sent (counciltabsmodel.ts). The parent row sets the height; each tab fills it.

import { cn } from "@/util/util";
import { FileText, MessagesSquare } from "lucide-react";
import { showCouncil } from "./agentcenter";
import { discussionCount } from "./counciltabsmodel";

const TAB =
    "flex h-full items-center gap-[7px] border-b-2 px-[2px] text-[13.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function CouncilTabs({
    c,
    view,
    className,
}: {
    c: Council;
    view: "summary" | "discussion";
    className?: string;
}) {
    const count = discussionCount(c);
    const tab = (which: "summary" | "discussion") =>
        cn(
            TAB,
            view === which
                ? "border-primary font-semibold text-primary"
                : "cursor-pointer border-transparent font-medium text-secondary hover:text-primary"
        );
    const open = (which: "summary" | "discussion") => {
        if (view !== which) {
            showCouncil(c.id, which);
        }
    };
    return (
        <div role="tablist" aria-label="Council view" className={cn("flex items-stretch gap-5", className)}>
            <button
                type="button"
                role="tab"
                aria-selected={view === "summary"}
                data-council-tab="summary"
                className={tab("summary")}
                onClick={() => open("summary")}
            >
                <FileText size={14} aria-hidden />
                Report
            </button>
            <button
                type="button"
                role="tab"
                aria-selected={view === "discussion"}
                data-council-tab="discussion"
                className={tab("discussion")}
                onClick={() => open("discussion")}
            >
                <MessagesSquare size={14} aria-hidden />
                Discussion
                {count !== "" && (
                    <span
                        data-council-tab-count
                        className="rounded-full bg-pill px-[7px] py-px text-[12px] font-medium text-muted tabular-nums"
                    >
                        {count}
                    </span>
                )}
            </button>
        </div>
    );
}
