// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The bug box: a popover above the footer's right group (docs/superpowers/specs/2026-11-19-bug-report-design.md, "The
// button and its box"). Title and the count waiting for Jarvis on one line, the window's picture beside the "Chuyện gì
// sai?" text box, one line saying what goes with the report, then Huỷ and Gửi. Under the picture, Khoanh vùng lays the
// picture over the whole window to drag a rectangle on (RegionPicker, the canvas bug-report's Region boards); the box
// stays mounted, hidden, so its text and focus come back as they were. Mounted once in the always-mounted shell
// (cockpit-root.tsx); the footer's button, Ctrl+Alt+R and the palette all open it through bugreportstore.ts.

import { takeModalFocus } from "@/app/modals/modalfocus";
import { isTopModal, registerModal } from "@/app/modals/modalstack";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useId, useRef, useState } from "react";
import {
    anchorRight,
    BOX_WIDTH,
    canSend,
    dragRect,
    thumbCrop,
    toImageRegion,
    waitingLabel,
    type BugReportOpen,
    type Region,
    type Size,
} from "./bugreportboxmodel";
import {
    bugReportAtom,
    clearBugRegion,
    closeBugReport,
    finishBugRegion,
    focusBeforeBugReport,
    sendBugReport,
    setBugReportText,
    startBugRegion,
} from "./bugreportstore";

// the thumb's size in CSS px (h-[60px] w-24)
const THUMB: Size = { w: 96, h: 60 };

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

function Thumb({ url, capture, box }: { url: string | null; capture: Blob | null; box: BugReportOpen }) {
    // a framed region fills the thumb, in the accent's frame; else the picture from its top left
    const crop = box.region != null && box.captureSize != null ? thumbCrop(box.region, box.captureSize, THUMB) : null;
    return (
        <div
            data-bug-report-thumb={capture != null ? "img" : "none"}
            data-bug-report-region={box.region != null ? `${box.region.w}x${box.region.h}` : undefined}
            className={cn(
                "relative h-[60px] w-24 shrink-0 overflow-hidden rounded-[6px] bg-surface",
                crop != null ? "border-2 border-accent" : "border border-edge-mid"
            )}
        >
            {url != null && crop != null ? (
                <img
                    src={url}
                    alt=""
                    draggable={false}
                    className="absolute max-w-none"
                    style={{ width: crop.width, height: crop.height, left: crop.left, top: crop.top }}
                />
            ) : url != null ? (
                <img src={url} alt="" draggable={false} className="h-full w-full object-cover object-left-top" />
            ) : (
                <span className="flex h-full items-center justify-center px-1 text-center text-[10.5px] leading-tight text-muted">
                    {capture != null ? "" : "Không có ảnh"}
                </span>
            )}
        </div>
    );
}

// Khoanh vùng under the picture; once a region is set, Khoanh lại and Bỏ vùng. Nothing without a picture to frame on.
function RegionButtons({ box }: { box: BugReportOpen }) {
    if (box.captureSize == null) {
        return null;
    }
    if (box.region == null) {
        return (
            <button
                type="button"
                data-bug-report-region-start=""
                title="Kéo trên ảnh để khoanh chỗ sai"
                disabled={box.sending}
                onClick={startBugRegion}
                className="flex h-6 w-24 cursor-pointer items-center justify-center gap-[5px] rounded-[6px] border border-edge-strong text-[11.5px] text-primary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40"
            >
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray="3 3"
                    aria-hidden="true"
                >
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                </svg>
                Khoanh vùng
            </button>
        );
    }
    return (
        <div className="flex w-24 justify-between text-[11.5px]">
            <button
                type="button"
                data-bug-report-region-again=""
                disabled={box.sending}
                onClick={startBugRegion}
                className="cursor-pointer text-accent-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default"
            >
                Khoanh lại
            </button>
            <button
                type="button"
                data-bug-report-region-clear=""
                disabled={box.sending}
                onClick={clearBugRegion}
                className="cursor-pointer text-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default"
            >
                Bỏ vùng
            </button>
        </div>
    );
}

// The picture over the whole window, to drag a rectangle on: what is outside it dims, its size shows under it, Enter
// keeps it (in the picture's pixels) and Esc leaves the region as it was. A modal of its own above the box, so the box's
// Esc stands down while it shows.
function RegionPicker({ url, image }: { url: string; image: Size }) {
    const pickerId = useId();
    const [from, setFrom] = useState<{ x: number; y: number } | null>(null);
    const [rect, setRect] = useState<Region | null>(null);
    const rectRef = useRef<Region | null>(null);
    rectRef.current = rect;

    useEffect(() => registerModal(pickerId), [pickerId]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!isTopModal(pickerId)) {
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                finishBugRegion(null);
            } else if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                const r = rectRef.current;
                const view = { w: window.innerWidth, h: window.innerHeight };
                finishBugRegion(r == null ? null : toImageRegion(r, view, image));
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [pickerId, image]);

    const at = (e: React.PointerEvent) => ({ x: e.clientX, y: e.clientY });
    return (
        <div
            data-bug-report-picker=""
            role="dialog"
            aria-label="Khoanh chỗ sai"
            className="fixed inset-0 z-[70] cursor-crosshair select-none"
            onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setFrom(at(e));
                setRect(null);
            }}
            onPointerMove={(e) => {
                if (from != null) {
                    setRect(dragRect(from, at(e), { w: window.innerWidth, h: window.innerHeight }));
                }
            }}
            onPointerUp={() => setFrom(null)}
        >
            <img src={url} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />
            {rect == null ? (
                <div className="pointer-events-none absolute inset-0 bg-black/55" />
            ) : (
                <>
                    {/* the dim around the region; the region keeps the picture as it was */}
                    <div
                        data-bug-report-picker-rect={`${Math.round(rect.w)}x${Math.round(rect.h)}`}
                        className="pointer-events-none absolute rounded-[3px] border-2 border-accent shadow-[0_0_0_100vmax_rgb(0_0_0/0.55)]"
                        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                    />
                    <span
                        className="pointer-events-none absolute rounded-[4px] bg-accent px-1.5 py-0.5 font-mono text-[11px] text-background"
                        style={{ left: rect.x, top: rect.y + rect.h + 4 }}
                    >
                        {Math.round(rect.w)} × {Math.round(rect.h)}
                    </span>
                </>
            )}
            <div className="frost pointer-events-none absolute left-1/2 top-3.5 flex -translate-x-1/2 items-center gap-3.5 rounded-[10px] border border-edge-mid px-3.5 py-2 text-[12.5px] text-secondary shadow-popover">
                <span className="font-semibold text-primary">Kéo để khoanh chỗ sai</span>
                <span>
                    <kbd className="font-mono text-primary">Enter</kbd> xong
                </span>
                <span>
                    <kbd className="font-mono text-primary">Esc</kbd> bỏ, về hộp báo lỗi
                </span>
            </div>
        </div>
    );
}

function OpenBox({ box }: { box: BugReportOpen }) {
    const panelRef = useRef<HTMLDivElement>(null);
    const url = useObjectUrl(box.capture);
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
        <>
            {box.selecting && url != null && box.captureSize != null ? (
                <RegionPicker url={url} image={box.captureSize} />
            ) : null}
            <div
                ref={panelRef}
                data-bug-report-box=""
                role="dialog"
                aria-label="Báo lỗi arcterm"
                tabIndex={-1}
                style={{ right, width: BOX_WIDTH }}
                className={cn(
                    "frost fixed bottom-9 z-[60] flex max-w-[calc(100vw-16px)] flex-col gap-2.5 rounded-[10px] border border-edge-strong p-3.5 shadow-popover outline-none",
                    box.selecting && "hidden"
                )}
            >
                <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13.5px] font-semibold text-primary">Báo lỗi arcterm</span>
                    <span data-bug-report-waiting={box.waiting} className="text-[12px] text-secondary">
                        {waitingLabel(box.waiting)}
                    </span>
                </div>
                <div className="flex items-start gap-2.5">
                    <div className="flex shrink-0 flex-col gap-1.5">
                        <Thumb url={url} capture={box.capture} box={box} />
                        <RegionButtons box={box} />
                    </div>
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
                    {box.region != null
                        ? "Kèm ảnh cả cửa sổ với vùng khoanh đánh dấu, và log 5 phút cuối. Chỉ lưu trên máy này."
                        : "Kèm ảnh chụp cửa sổ lúc bấm và log 5 phút cuối. Chỉ lưu trên máy này."}
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
        </>
    );
}

export function BugReportBox() {
    const box = useAtomValue(bugReportAtom);
    // `capturing` draws nothing: the picture is of the window without the box
    return box.kind === "open" ? <OpenBox box={box} /> : null;
}
