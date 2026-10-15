// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The tray popover's two subpages (spec 2026-10-15-tray-popover-design.md): Free up memory, arcterm's agents by
// footprint with Stop on each one's heaviest command, and Clean up storage, Settings → Storage's categories with the
// cleanable ones cleaned in place after a second click.

import { cn } from "@/util/util";
import { useState } from "react";
import { autoCleanLine, fmtSize, LEVEL_BAR, split } from "./trayformat";
import { CARD, OPEN_BUTTON, PressureWord, ROW_BUTTON, type Send, SubHeader } from "./traypage";
import type { TraySnapshot } from "./traytypes";

export function FreeUpPage({ s, send, back }: { s: TraySnapshot; send: Send; back: () => void }) {
    const m = s.machine;
    const c = s.consumers;
    const level = m?.pressure ?? "unknown";
    const used = m ? m.memTotal - m.memAvailable : 0;
    const bar = m && c?.arcBytes != null ? split(m.memTotal, used, c.arcBytes) : { arc: 0, other: 0 };
    const monitor = s.platform === "win" ? "Open Task Manager ↗" : "Open Activity Monitor ↗";
    return (
        <div className="flex flex-col gap-2">
            <SubHeader
                title="Free up memory"
                back={back}
                right={<PressureWord level={level} platform={s.platform} />}
            />
            <div className={CARD}>
                <div className="flex items-baseline gap-1.5">
                    <span className="text-[20px] font-semibold tabular-nums text-primary">
                        {m ? fmtSize(m.memAvailable) : "—"}
                    </span>
                    {m ? <span className="text-[11px] text-muted">free of {fmtSize(m.memTotal)}</span> : null}
                </div>
                <div className="flex h-[5px] overflow-hidden rounded-[3px] bg-background">
                    <div
                        title="arcterm and its agents"
                        className={cn("h-full", LEVEL_BAR[level])}
                        style={{ width: `${bar.arc}%` }}
                    />
                    <div title="Other apps" className="h-full bg-ink-faint" style={{ width: `${bar.other}%` }} />
                </div>
                {c?.arcBytes != null && c.otherBytes != null ? (
                    <div className="flex gap-3 text-[10.5px] tabular-nums text-muted">
                        <span className="flex items-center gap-1">
                            <span className={cn("h-[5px] w-2 rounded-[2px]", LEVEL_BAR[level])} />
                            arcterm {fmtSize(c.arcBytes)}
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="h-[5px] w-2 rounded-[2px] bg-ink-faint" />
                            Other apps {fmtSize(c.otherBytes)}
                        </span>
                    </div>
                ) : null}
            </div>
            <div className={cn(CARD, "gap-0 py-1.5")}>
                {c == null ? <span className="py-1.5 text-[12px] text-muted">Reading…</span> : null}
                {c?.rows.map((r) => (
                    <div key={r.blockId} data-tray-consumer={r.blockId} className="flex flex-col gap-[2px] py-1.5">
                        <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">
                                {r.name} <span className="text-[11px] text-muted">{r.kind}</span>
                            </span>
                            <span className="text-[12px] font-semibold tabular-nums text-secondary">
                                {r.bytes != null ? fmtSize(r.bytes) : "–"}
                            </span>
                            <button
                                type="button"
                                aria-label={`Open ${r.name} in arcterm`}
                                onClick={() => send({ kind: "open-agent", blockId: r.blockId })}
                                className={OPEN_BUTTON}
                            >
                                ↗
                            </button>
                        </div>
                        {r.heaviest ? (
                            <div className="flex items-center gap-1.5">
                                <span
                                    className="min-w-0 flex-1 truncate text-[11px] text-muted"
                                    title={r.heaviest.command}
                                >
                                    heaviest: {r.heaviest.command}
                                </span>
                                <span className="text-[11px] tabular-nums text-muted">{fmtSize(r.heaviest.bytes)}</span>
                                <button
                                    type="button"
                                    data-tray-stop
                                    title="Stop this command alone; its agent sees it end and carries on"
                                    onClick={() => send({ kind: "stop", blockId: r.blockId, pid: r.heaviest!.pid })}
                                    className={cn(ROW_BUTTON, "text-error")}
                                >
                                    Stop
                                </button>
                            </div>
                        ) : (
                            <span className="text-[11px] text-muted">Nothing heavy running</span>
                        )}
                    </div>
                ))}
                {c != null && c.ownBytes != null ? (
                    <div className="flex items-center gap-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">
                            arcterm <span className="text-[11px] text-muted">app, server and webview</span>
                        </span>
                        <span className="text-[12px] font-semibold tabular-nums text-secondary">
                            {fmtSize(c.ownBytes)}
                        </span>
                    </div>
                ) : null}
            </div>
            <div className="flex items-center gap-2 px-0.5">
                <span className="flex-1 text-[11px] tabular-nums text-muted">
                    {c?.otherBytes != null ? `Other apps hold ${fmtSize(c.otherBytes)}.` : ""}
                </span>
                <button type="button" onClick={() => send({ kind: "open-monitor" })} className={ROW_BUTTON}>
                    {monitor}
                </button>
            </div>
            <span className="px-0.5 text-[10.5px] text-muted">
                {level === "high" || level === "critical"
                    ? "While pressure is high, new heavy jobs wait their turn on their own."
                    : "New heavy jobs start as RAM allows."}
            </span>
        </div>
    );
}

export function StoragePage({ s, send, back }: { s: TraySnapshot; send: Send; back: () => void }) {
    const [armed, setArmed] = useState<string | null>(null);
    const m = s.machine;
    const st = s.storage;
    const autoLine = autoCleanLine(st?.lastAuto ?? null, Date.now());
    return (
        <div className="flex flex-col gap-2">
            <SubHeader
                title="Clean up storage"
                back={back}
                right={
                    m ? <span className="text-[11px] tabular-nums text-muted">{fmtSize(m.diskFree)} free</span> : null
                }
            />
            {st == null ? (
                <div className={CARD}>
                    <span className="text-[12px] text-muted">Not scanned yet.</span>
                </div>
            ) : (
                <>
                    <div className={cn(CARD, "gap-1")}>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-[20px] font-semibold tabular-nums text-primary">
                                {fmtSize(st.arcBytes)}
                            </span>
                            <span className="text-[11px] text-muted">on disk for arcterm and its agents</span>
                        </div>
                        <span className="text-[10.5px] tabular-nums text-muted">
                            {fmtSize(st.cleanableBytes)} can be cleaned{autoLine ? ` · ${autoLine}` : ""}
                        </span>
                    </div>
                    <div className={cn(CARD, "gap-0 py-1.5")}>
                        {st.rows.map((r) => (
                            <div
                                key={r.category}
                                data-tray-storage-row={r.category}
                                className="flex flex-col gap-[2px] py-1.5"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">
                                        {r.title}
                                    </span>
                                    <span className="text-[12px] font-semibold tabular-nums text-secondary">
                                        {fmtSize(r.bytes)}
                                    </span>
                                    {r.action != null && r.cleanableBytes > 0 ? (
                                        <button
                                            type="button"
                                            data-tray-clean={r.category}
                                            onClick={() => {
                                                if (armed === r.category) {
                                                    setArmed(null);
                                                    send({ kind: "clean", category: r.category });
                                                } else {
                                                    setArmed(r.category);
                                                }
                                            }}
                                            onBlur={() => setArmed((a) => (a === r.category ? null : a))}
                                            className={cn(ROW_BUTTON, armed === r.category && "text-error")}
                                        >
                                            {armed === r.category
                                                ? `${r.action} ${fmtSize(r.cleanableBytes)}?`
                                                : r.action}
                                        </button>
                                    ) : null}
                                    {r.go != null ? (
                                        <button
                                            type="button"
                                            aria-label={
                                                r.go === "gallery"
                                                    ? "Open the Canvas gallery"
                                                    : `Open ${r.title} in Settings`
                                            }
                                            onClick={() =>
                                                send({
                                                    kind: r.go === "gallery" ? "open-gallery" : "open-storage-settings",
                                                })
                                            }
                                            className={OPEN_BUTTON}
                                        >
                                            ↗
                                        </button>
                                    ) : null}
                                </div>
                                <span className="text-[11px] text-muted">{r.detail}</span>
                            </div>
                        ))}
                        <div className="flex flex-col gap-[2px] py-1.5">
                            <div className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">
                                    arcterm store
                                </span>
                                <span className="text-[12px] font-semibold tabular-nums text-secondary">
                                    {fmtSize(st.storeBytes)}
                                </span>
                            </div>
                            <span className="text-[11px] text-muted">Agents, runs and settings. Never cleaned.</span>
                        </div>
                    </div>
                </>
            )}
            <button
                type="button"
                onClick={() => send({ kind: "open-storage-settings" })}
                className="h-7 cursor-pointer rounded border border-edge-mid bg-surface-raised text-[12px] text-secondary hover:border-edge-strong hover:bg-surface-hover"
            >
                Open Settings → Storage
            </button>
        </div>
    );
}
