// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A council as a row of Library's Conversations (conversationhistory.tsx), in either of the two places it stands: a card of
// its own (CouncilHistoryRowView: a council no listed session started, and every row of the list the Council chip shows),
// or a tree line under the session that started it (CouncilNestedLine). The tree keeps only some councils (live, pinned,
// unread or recent ones), so this is where an older one is found again: a row opens the council through openCouncil
// (librarystore.ts: one the tree keeps opens on Agent, a closed one inside Library), a pin marks a pinned one, and each
// row's hover button and menu Pin it (Unpin a pinned one), which keeps it at the top of its project in the tree. A council
// the tree no longer lists also offers Resume (councilresume.tsx), which puts it back in the tree for a day and opens its
// Discussion on Agent. Thin: the rows and the pin action come from councilhistory.ts, and the list that holds them from
// conversationrows.ts.

import { ContextMenuModel } from "@/app/store/contextmenu";
import { fireAndForget } from "@/util/util";
import { Hash, Pin, PinOff, Play } from "lucide-react";
import type { MouseEvent } from "react";
import { openCouncil } from "../library/librarystore";
import type { AgentsViewModel } from "./agents";
import { formatAgeShort } from "./agentsviewmodel";
import { COUNCIL_TONE, CouncilSeatPair } from "./agenttree";
import { councilHistoryPinAct, type CouncilHistoryRow } from "./councilhistory";
import { resumeCouncil } from "./councilresume";
import { setCouncilPinned } from "./councilstore";

const ACT_BUTTON =
    "flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-[4px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent";

// What a row does besides open: the pin act, and the menu (Copy id, Resume on a council the tree no longer lists, Pin or
// Unpin as the tree's council row has them)
function rowActions(row: CouncilHistoryRow, model: AgentsViewModel) {
    const pin = councilHistoryPinAct(row);
    const PinIcon = row.pinned ? PinOff : Pin;
    const act = () => fireAndForget(() => setCouncilPinned(row.id, pin.pin));
    const onContextMenu = (e: MouseEvent) => {
        const items: ContextMenuItem[] = [
            {
                label: "Copy id",
                sublabel: row.id,
                icon: <Hash size={15} />,
                click: () => void navigator.clipboard.writeText(row.id),
            },
            { type: "separator" } as const,
            ...(row.resumable
                ? [{ label: "Resume", icon: <Play size={15} />, click: () => resumeCouncil(row.id, model) }]
                : []),
            { label: pin.label, icon: <PinIcon size={15} />, click: act },
        ];
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };
    return { pin, PinIcon, act, onContextMenu };
}

// The hover buttons: Resume on a council the tree no longer lists, then Pin (Unpin on a pinned one). They sit beside the
// row's button, which cannot hold them, and show on hover or when one has focus.
function RowButtons({ row, model }: { row: CouncilHistoryRow; model: AgentsViewModel }) {
    const { pin, PinIcon, act } = rowActions(row, model);
    return (
        <span className="flex flex-none items-center pl-[6px] pr-[8px] opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover:opacity-100">
            {row.resumable ? (
                <button
                    type="button"
                    data-council-history-act="resume"
                    title="Resume: back in the tree, Discussion open; nothing runs until you reply"
                    aria-label={`Resume ${row.feature}`}
                    onClick={() => resumeCouncil(row.id, model)}
                    className={ACT_BUTTON}
                >
                    <Play size={13} aria-hidden />
                </button>
            ) : null}
            <button
                type="button"
                data-council-history-act={pin.act}
                title={pin.label}
                aria-label={`${pin.label} ${row.feature}`}
                onClick={act}
                className={ACT_BUTTON}
            >
                <PinIcon size={13} aria-hidden />
            </button>
        </span>
    );
}

function PinMark() {
    return (
        <Pin
            data-council-history-pin-mark
            role="img"
            aria-label="Pinned"
            size={12}
            strokeWidth={2}
            className="flex-none text-muted"
        />
    );
}

/** One council as a card: its seats' picture, its feature, then its project and its state in a word in its tone; at the
 *  right a pin when the person pinned it, and the time since its newest message. In the list the Council chip shows
 *  `startedFrom` names the session that started it, under them. A click opens it; Hover shows Pin (Unpin on a pinned one),
 *  and the menu offers Copy id and the same Pin / Unpin, as the tree's council row does; a council the tree no longer
 *  lists adds Resume to both, ahead of Pin. */
export function CouncilHistoryRowView({
    row,
    now,
    model,
    startedFrom,
}: {
    row: CouncilHistoryRow;
    now: number;
    model: AgentsViewModel;
    startedFrom?: string;
}) {
    const tone = COUNCIL_TONE[row.tone];
    const { onContextMenu } = rowActions(row, model);
    return (
        <div
            data-council-history-item={row.id}
            onContextMenu={onContextMenu}
            className="group group/council flex items-center rounded-[10px] border border-border bg-surface transition-colors duration-[140ms] hover:border-edge-strong"
        >
            <button
                type="button"
                data-council-history-row={row.id}
                data-council-history-pinned={row.pinned ? "" : undefined}
                title={row.question !== "" ? `${row.feature}\n${row.question}` : row.feature}
                onClick={() => openCouncil(model, row.id)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-[12px] rounded-[10px] py-[8px] pl-[10px] text-left"
            >
                <CouncilSeatPair seats={row.seats} dot={row.dot} selected={false} onPage />
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-[6px]">
                        <span className="min-w-0 truncate text-[13px] leading-[17px] text-primary">{row.feature}</span>
                        {row.unread ? (
                            <span
                                role="img"
                                aria-label="Not opened since it ended"
                                className="h-[6px] w-[6px] flex-none rounded-full bg-primary"
                            />
                        ) : null}
                    </div>
                    <div className="mt-[2px] flex min-w-0 items-center text-[11.5px] leading-[15px]">
                        <span className="flex-none text-secondary">{row.projectName}</span>
                        <span className="min-w-0 truncate">
                            <span className="text-muted">&nbsp;·&nbsp;</span>
                            <span className={tone.text}>{row.meta}</span>
                        </span>
                    </div>
                    {startedFrom != null ? (
                        <div
                            data-council-history-from
                            title={startedFrom}
                            className="mt-[2px] truncate text-[11px] leading-[15px] text-muted"
                        >
                            {startedFrom}
                        </div>
                    ) : null}
                </div>
                {row.pinned ? <PinMark /> : null}
                <span className="w-[32px] flex-none text-right text-[11.5px] tabular-nums text-muted">
                    {formatAgeShort(now - row.lastAt)}
                </span>
            </button>
            <RowButtons row={row} model={model} />
        </div>
    );
}

/** One council nested under the session that started it: a tree line (`└ Council: <feature>`), with the same click, hover
 *  buttons and menu as its card. */
export function CouncilNestedLine({
    row,
    line,
    model,
}: {
    row: CouncilHistoryRow;
    line: string;
    model: AgentsViewModel;
}) {
    const { onContextMenu } = rowActions(row, model);
    return (
        <div
            data-history-nested="council"
            data-council-history-item={row.id}
            onContextMenu={onContextMenu}
            className="group group/council flex items-center rounded-[6px] transition-colors duration-[140ms] hover:bg-surface-hover"
        >
            <button
                type="button"
                data-council-history-row={row.id}
                data-council-history-pinned={row.pinned ? "" : undefined}
                title={row.question !== "" ? `${row.feature}\n${row.question}` : row.feature}
                onClick={() => openCouncil(model, row.id)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[6px] py-[5px] pl-1.5 text-left text-[12.5px] text-secondary"
            >
                <span aria-hidden className="flex-none text-muted">
                    └
                </span>
                <span className="min-w-0 flex-1 truncate">{line}</span>
                {row.pinned ? <PinMark /> : null}
            </button>
            <RowButtons row={row} model={model} />
        </div>
    );
}
