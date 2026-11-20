// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rail session block's Compacted line: the agent's last compaction, as Chat's divider words it ("Compacted ·
// 202k → 13k · manual"), with when and how many. A click opens the summary it kept in a sheet pinned to the window's
// right edge, wider than the rail, which is the one place the summary is drawn (Chat's divider shows only the line).
// The data is subagentsstore.ts's compactionsByIdAtom, the words railcompaction.ts's.

import { ModalShell } from "@/app/modals/modalshell";
import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MarkdownMessage } from "./markdownmessage";
import { compactionFacts } from "./railcompaction";
import { compactionSheetOpenAtom } from "./railcompactionsheetatom";
import { compactionsByIdAtom } from "./subagentsstore";

export function RailCompactionLine({ agentId, now }: { agentId: string; now: number }) {
    const list = useAtomValue(compactionsByIdAtom)[agentId];
    // the Agent surface's box when the sheet opened: the sheet covers its right side, not the rail it was opened from
    const [frame, setFrame] = useState<DOMRect | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const open = frame != null;
    // the key dispatcher counts the sheet as a modal while this is set (railcompactionsheetatom.ts); the cleanup runs on
    // close and when the rail unmounts with the sheet open, so the flag cannot stay set
    useEffect(() => {
        if (!open) {
            return;
        }
        globalStore.set(compactionSheetOpenAtom, true);
        return () => globalStore.set(compactionSheetOpenAtom, false);
    }, [open]);
    const facts = compactionFacts(list, now);
    if (facts == null) {
        return null;
    }
    const summary = list![list!.length - 1].summary;
    const canOpen = !!summary;
    const close = () => setFrame(null);
    const openSheet = () => {
        const surface = rootRef.current?.closest("[data-cockpit-surface-wrap]") ?? document.body;
        setFrame(surface.getBoundingClientRect());
    };
    return (
        <div ref={rootRef} data-rail-compaction className="mt-[8px]">
            <button
                type="button"
                disabled={!canOpen}
                onClick={openSheet}
                aria-haspopup={canOpen ? "dialog" : undefined}
                title={canOpen ? "Show the summary it kept" : undefined}
                className={cn(
                    "-mx-[6px] flex w-[calc(100%+12px)] min-w-0 items-center gap-[7px] rounded-[7px] px-[6px] py-[3px] text-left text-[11px] tabular-nums",
                    canOpen ? "cursor-pointer hover:bg-surface-hover" : "cursor-default"
                )}
            >
                <span className="flex-none text-[10px] font-semibold uppercase tracking-[0.1em] text-accent-soft">
                    Compacted
                </span>
                <span className="min-w-0 flex-1 truncate text-muted">{facts}</span>
                {canOpen ? <ChevronRight size={12} aria-hidden className="flex-none text-accent-soft" /> : null}
            </button>
            {canOpen && frame != null
                ? createPortal(
                      // portaled out of the rail: a sheet fills its nearest positioned box, which in the rail is the rail
                      // itself, and the surface's own keys would take its Esc
                      <div
                          className="fixed z-[60]"
                          style={{ top: frame.top, left: frame.left, width: frame.width, height: frame.height }}
                      >
                          <ModalShell open variant="sheet" onClose={close} className="h-full w-[720px] max-w-[92vw]">
                              <div data-rail-compaction-summary className="flex h-full min-h-0 flex-col bg-surface">
                                  <div className="flex flex-none items-center gap-2.5 border-b border-edge-faint px-[18px] py-4">
                                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-accent-soft">
                                          Compacted
                                      </span>
                                      <span className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-muted">
                                          {facts}
                                      </span>
                                      <button
                                          type="button"
                                          aria-label="Close"
                                          title="Close (Esc)"
                                          onClick={close}
                                          className="flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[6px] border border-edge-faint bg-surface-raised text-muted hover:border-edge-strong hover:text-ink-hi"
                                      >
                                          <X size={13} aria-hidden />
                                      </button>
                                  </div>
                                  <div className="sc min-h-0 flex-1 overflow-y-auto px-[18px] py-3.5 text-[13px]">
                                      <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">
                                          Summary — kept context
                                      </div>
                                      <MarkdownMessage text={summary!} />
                                  </div>
                              </div>
                          </ModalShell>
                      </div>,
                      document.body
                  )
                : null}
        </div>
    );
}
