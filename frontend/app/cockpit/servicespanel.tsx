// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Services popover (spec 2026-10-20-held-services-design.md): every held service, those that need the person first
// (popoverOrder), with its state in words, and on hover Log, Restart, Start and Stop. It hangs from the app bar's
// Services chip and shares the Jobs panel's frame. servicesmodel.ts decides the words, the order and which buttons
// apply; this draws. A click on a row opens its terminal in the Agent centre, which starts a sleeping one (its pane is
// then on screen); no hover Start on a sleeping row. Mounted once in cockpit-root.

import { pushToast } from "@/app/cockpit/notificationstore";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { PANEL_WIDTH } from "@/app/view/agents/consumers";
import { usePanelPlacement } from "@/app/view/agents/consumerspanel";
import {
    canRestart,
    canStartFromPopover,
    canStop,
    popoverOrder,
    serviceRowWords,
    upFor,
    type ServiceTone,
} from "@/app/view/agents/servicesmodel";
import { openService, restartService, servicesAtom, startService, stopService } from "@/app/view/agents/servicesstore";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { servicesOpenAtom, servicesOpenerAtom } from "./servicespopoverstore";

const TONE = {
    working: { text: "text-working", dot: "bg-working", ring: "border-working" },
    error: { text: "text-error", dot: "bg-error", ring: "border-error" },
    warning: { text: "text-warning", dot: "bg-warning", ring: "border-warning" },
    muted: { text: "text-muted", dot: "bg-muted", ring: "border-muted" },
} as const satisfies Record<ServiceTone, { text: string; dot: string; ring: string }>;

// the Jobs popover's row button (jobqueuepanel.tsx)
const ROW_BUTTON =
    "cursor-pointer rounded border border-edge-mid px-1.5 py-[1px] text-[11px] text-secondary hover:border-edge-strong hover:bg-surface-hover";

function close(): void {
    globalStore.set(servicesOpenAtom, false);
}

function act(what: string, call: () => Promise<void>): void {
    fireAndForget(async () => {
        try {
            await call();
        } catch (e) {
            pushToast({ title: `Couldn't ${what}`, message: String(e), level: "error" });
        }
    });
}

// A click, Enter or Log: the service's terminal takes the Agent centre. One that never ran is given its tab and block
// first (openService); nothing here starts it, though a sleeping one starts once its pane shows (the Seen report), and
// a crashed one shows its log.
function openRow(model: AgentsViewModel, s: ServiceStatus): void {
    close();
    fireAndForget(async () => {
        const tabId = s.tabid || (await openService(s.id))?.tabid;
        if (!tabId) {
            pushToast({ title: `Couldn't open ${s.name}`, message: "arcterm gave it no terminal", level: "error" });
            return;
        }
        await openTarget(model, { kind: "agent", tabId });
    });
}

// the clock the rows' up time and retry seconds read, ticking once a second while the popover is open
function useNow(open: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!open) {
            return;
        }
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [open]);
    return now;
}

// the folder's own name, or `~` for the home folder a service with no dir runs in
function folderName(dir: string): string {
    const parts = dir.split(/[\\/]/).filter((p) => p !== "");
    return parts.length === 0 ? "~" : parts[parts.length - 1];
}

function Row({
    service,
    now,
    highlighted,
    model,
}: {
    service: ServiceStatus;
    now: number;
    highlighted: boolean;
    model: AgentsViewModel;
}) {
    const w = serviceRowWords(service, now);
    const tone = TONE[w.tone];
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (highlighted) {
            ref.current?.scrollIntoView?.({ block: "nearest" });
        }
    }, [highlighted]);
    const hasLog = service.state === "crashed" || service.state === "retrying";
    const press = (e: { stopPropagation(): void }, call: () => Promise<void>, what: string) => {
        e.stopPropagation();
        act(what, call);
    };
    return (
        <div
            ref={ref}
            data-service-row={service.id}
            data-service-state={service.state}
            data-highlighted={highlighted ? "" : undefined}
            onClick={() => openRow(model, service)}
            className={cn(
                "group flex cursor-pointer flex-col gap-[1px] px-3 py-[5px] hover:bg-surface-hover",
                highlighted && "bg-surface-hover"
            )}
        >
            <div className="flex items-center gap-2">
                <span
                    aria-hidden
                    data-service-dot={w.dot}
                    className={cn(
                        "h-[7px] w-[7px] flex-none rounded-full",
                        w.dot === "hollow" ? cn("border bg-transparent", tone.ring) : tone.dot,
                        w.dot === "pulse" && "pulse-dot"
                    )}
                />
                <span data-service-name className="min-w-0 truncate text-[12.5px] text-primary" title={service.name}>
                    {service.name}
                </span>
                <span data-service-project className="min-w-0 flex-1 truncate text-[11px] text-muted">
                    {service.project}
                </span>
                {w.words !== "" ? (
                    <span data-service-words className={cn("flex-none whitespace-nowrap text-[12px]", tone.text)}>
                        {w.words}
                    </span>
                ) : null}
                {w.port != null ? (
                    <span data-service-port className="flex-none text-[12px] tabular-nums text-secondary">
                        {w.port}
                    </span>
                ) : null}
                {service.state === "running" ? (
                    <span data-service-up className="flex-none text-[12px] tabular-nums text-secondary">
                        {upFor(now - (service.startedms ?? now))}
                    </span>
                ) : null}
                <span
                    className={cn(
                        "flex flex-none items-center gap-1 opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover:opacity-100",
                        highlighted && "opacity-100"
                    )}
                >
                    {hasLog ? (
                        <button
                            type="button"
                            data-service-log
                            title="Show its terminal"
                            onClick={(e) => {
                                e.stopPropagation();
                                openRow(model, service);
                            }}
                            className={ROW_BUTTON}
                        >
                            Log
                        </button>
                    ) : null}
                    {canRestart(service) ? (
                        <button
                            type="button"
                            data-service-restart
                            title="Stop it and start it again"
                            onClick={(e) => press(e, () => restartService(service.id), "restart the service")}
                            className={ROW_BUTTON}
                        >
                            Restart
                        </button>
                    ) : null}
                    {canStartFromPopover(service) ? (
                        <button
                            type="button"
                            data-service-start
                            title="Start it"
                            onClick={(e) => press(e, () => startService(service.id), "start the service")}
                            className={ROW_BUTTON}
                        >
                            Start
                        </button>
                    ) : null}
                    {canStop(service) ? (
                        <button
                            type="button"
                            data-service-stop
                            title="Stop it, and keep it stopped until you start it"
                            onClick={(e) => press(e, () => stopService(service.id), "stop the service")}
                            className={ROW_BUTTON}
                        >
                            Stop
                        </button>
                    ) : null}
                </span>
            </div>
            <div data-service-source className="truncate pl-[15px] text-[11px] text-muted">
                <span className="font-mono">{service.command}</span>
                {` in ${folderName(service.dir)}`}
            </div>
        </div>
    );
}

export function ServicesPanel({ model }: { model: AgentsViewModel }) {
    const open = useAtomValue(servicesOpenAtom);
    const list = useAtomValue(servicesAtom);
    const placement = usePanelPlacement(open, useAtomValue(servicesOpenerAtom));
    const now = useNow(open);
    const rows = useMemo(() => popoverOrder(list ?? []), [list]);
    // the row the arrow keys are on: the first one when the popover opens, so Enter at once opens it
    const [at, setAt] = useState(0);
    const rowsRef = useRef(rows);
    rowsRef.current = rows;
    const atRef = useRef(at);
    atRef.current = at;
    useEffect(() => {
        if (open) {
            setAt(0);
        }
    }, [open]);
    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            // a confirm over the panel owns Esc: it closes alone and the panel stays
            if (modalsModel.hasOpenModals()) {
                return;
            }
            const n = rowsRef.current.length;
            if (e.key === "Escape") {
                e.stopPropagation();
                close();
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                if (n === 0) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                const cur = atRef.current;
                setAt(e.key === "ArrowDown" ? Math.min(n - 1, cur + 1) : Math.max(0, Math.min(n - 1, cur) - 1));
            } else if (e.key === "Enter") {
                // Enter on a control inside the panel presses that control; one outside it (the chip that opened
                // the popover keeps focus after a click) does not own the key
                if (
                    (e.target as Element | null)?.closest?.(
                        "[data-services-panel] button, [data-services-panel] input, [data-services-panel] select, [data-services-panel] textarea"
                    )
                ) {
                    return;
                }
                const row = rowsRef.current[Math.min(atRef.current, n - 1)];
                if (row != null) {
                    e.preventDefault();
                    e.stopPropagation();
                    openRow(model, row);
                }
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [open, model]);
    return (
        <>
            {open ? <div data-services-backdrop className="fixed inset-0 z-50" onClick={close} /> : null}
            <PopoverReveal
                open={open}
                origin={placement.origin}
                // it hangs from the chip that opened it, wherever that sits
                style={{ right: placement.right, top: placement.top, bottom: placement.bottom, width: PANEL_WIDTH }}
                className="fixed z-[60] overflow-hidden rounded-lg border border-edge-strong bg-surface-raised shadow-popover"
            >
                <div data-services-panel role="dialog" aria-label="Services">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                        <span className="text-[12px] font-semibold text-secondary">Services</span>
                        <span className="flex-1 text-[11px] text-muted">held by arcterm</span>
                    </div>
                    <div data-services-list className="max-h-[56vh] overflow-y-auto py-1">
                        {rows.length === 0 ? (
                            <div data-services-empty className="px-3 py-2 text-[12px] text-muted">
                                No services.
                            </div>
                        ) : (
                            rows.map((s, i) => (
                                <Row
                                    key={s.id}
                                    service={s}
                                    now={now}
                                    highlighted={i === Math.min(at, rows.length - 1)}
                                    model={model}
                                />
                            ))
                        )}
                    </div>
                    <div data-services-footer className="border-t border-border px-3 py-[6px] text-[11px] text-muted">
                        A tool with a page is a service. Add one in Setup → Tools.
                    </div>
                </div>
            </PopoverReveal>
        </>
    );
}
