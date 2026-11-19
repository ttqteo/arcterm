// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The bug box: a popover above the footer's right group (docs/superpowers/specs/2026-11-19-bug-report-design.md, "The
// button and its box"). Title and the count waiting for Jarvis on one line, the window's picture beside the "Chuyện gì
// sai?" text box, one line saying what goes with the report, then Huỷ and Gửi. Mounted once in the always-mounted shell
// (cockpit-root.tsx); the footer's button, Ctrl+Alt+R and the palette all open it through bugreportstore.ts.

import { takeModalFocus } from "@/app/modals/modalfocus";
import { isTopModal, registerModal } from "@/app/modals/modalstack";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useId, useRef, useState } from "react";
import { anchorRight, BOX_WIDTH, canSend, waitingLabel, type BugReportOpen } from "./bugreportboxmodel";
import { bugReportAtom, closeBugReport, focusBeforeBugReport, sendBugReport, setBugReportText } from "./bugreportstore";

// the footer's bug button that is showing: the Cockpit surface draws its own footer beside the global one
function visibleButtonRight(): number | null {
    for (const b of document.querySelectorAll<HTMLElement>("[data-bug-report-button]")) {
        if (b.checkVisibility()) {
            return b.getBoundingClientRect().right;
        }
    }
    return null;
}

// the capture as a picture for as long as the box shows it
function useObjectUrl(blob: Blob | null): string | null {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (blob == null) {
            setUrl(null);
            return;
        }
        const made = URL.createObjectURL(blob);
        setUrl(made);
        return () => URL.revokeObjectURL(made);
    }, [blob]);
    return url;
}

function Thumb({ capture }: { capture: Blob | null }) {
    const url = useObjectUrl(capture);
    return (
        <div
            data-bug-report-thumb={capture != null ? "img" : "none"}
            className="h-[60px] w-24 shrink-0 overflow-hidden rounded-[6px] border border-edge-mid bg-surface"
        >
            {url != null ? (
                <img src={url} alt="" draggable={false} className="h-full w-full object-cover object-left-top" />
            ) : (
                <span className="flex h-full items-center justify-center px-1 text-center text-[10.5px] leading-tight text-muted">
                    {capture != null ? "" : "Không có ảnh"}
                </span>
            )}
        </div>
    );
}

function OpenBox({ box }: { box: BugReportOpen }) {
    const panelRef = useRef<HTMLDivElement>(null);
    const boxId = useId();
    const [right, setRight] = useState(() => anchorRight(visibleButtonRight(), window.innerWidth));
    const sendable = canSend(box.text, box.sending);

    // an open box owns the keyboard like a dialog: the surface's keys stand down under it (a modal is "open" to the key
    // dispatcher, so Esc here does not also stop an agent's turn or leave the surface), and closing hands focus back to
    // where the press found it
    useEffect(() => {
        const unregister = registerModal(boxId);
        const restore = takeModalFocus(null, focusBeforeBugReport());
        return () => {
            unregister();
            restore();
        };
    }, [boxId]);

    // Esc from anywhere, Ctrl+Enter from the box: on window capture, ahead of a focused terminal, which stops Escape
    // and Enter from reaching a bubble listener (modalfocus.ts). Only the topmost modal answers, so a palette opened over
    // the box gets its own Esc.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!isTopModal(boxId)) {
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeBugReport();
            } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && panelRef.current?.contains(e.target as Node)) {
                e.preventDefault();
                e.stopPropagation();
                void sendBugReport();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [boxId]);

    // the window resized under the open box: the button moved, so the box follows
    useEffect(() => {
        const onResize = () => setRight(anchorRight(visibleButtonRight(), window.innerWidth));
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    return (
        <div
            ref={panelRef}
            data-bug-report-box=""
            role="dialog"
            aria-label="Báo lỗi arcterm"
            tabIndex={-1}
            style={{ right, width: BOX_WIDTH }}
            className="frost fixed bottom-9 z-[60] flex max-w-[calc(100vw-16px)] flex-col gap-2.5 rounded-[10px] border border-edge-strong p-3.5 shadow-popover outline-none"
        >
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13.5px] font-semibold text-primary">Báo lỗi arcterm</span>
                <span data-bug-report-waiting={box.waiting} className="text-[12px] text-secondary">
                    {waitingLabel(box.waiting)}
                </span>
            </div>
            <div className="flex items-start gap-2.5">
                <Thumb capture={box.capture} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <label className="flex flex-col gap-1 text-[12px] text-secondary">
                        Chuyện gì sai?
                        <textarea
                            data-bug-report-text=""
                            autoFocus
                            rows={3}
                            value={box.text}
                            readOnly={box.sending}
                            onChange={(e) => setBugReportText(e.target.value)}
                            className="box-border w-full resize-none rounded-[7px] border border-edge-strong bg-surface px-[9px] py-[7px] text-[13px] leading-[19px] text-primary outline-none focus-visible:border-accent"
                        />
                    </label>
                    {box.error != null ? (
                        <span data-bug-report-error="" role="alert" className="text-[12px] leading-snug text-error">
                            {box.error}
                        </span>
                    ) : null}
                </div>
            </div>
            <div className="text-[12px] text-secondary">
                Kèm ảnh chụp cửa sổ lúc bấm và log 5 phút cuối. Chỉ lưu trên máy này.
            </div>
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    data-bug-report-cancel=""
                    onClick={closeBugReport}
                    className="flex h-7 cursor-pointer items-center rounded-[7px] px-3 text-[12.5px] text-secondary hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    Huỷ
                </button>
                <button
                    type="button"
                    data-bug-report-send=""
                    disabled={!sendable}
                    onClick={() => void sendBugReport()}
                    className={cn(
                        "flex h-7 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12.5px] font-semibold text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        sendable ? "cursor-pointer hover:bg-accenthover" : "cursor-default opacity-40"
                    )}
                >
                    Gửi
                    <span className="font-mono text-[11px] font-normal opacity-75">Ctrl+↵</span>
                </button>
            </div>
        </div>
    );
}

export function BugReportBox() {
    const box = useAtomValue(bugReportAtom);
    // `capturing` draws nothing: the picture is of the window without the box
    return box.kind === "open" ? <OpenBox box={box} /> : null;
}
