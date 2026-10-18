// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Storage: what arcterm and its agents leave on disk, per category, and cleaning it. storagemodel.ts
// decides what each card holds and says; pkg/storage measures and cleans, re-checking every rule at removal. The
// head and the category cards read the storage report (Design canvases is a summary with no rows: they are cleaned
// in the gallery; a build output project's row opens onto its folders); the Auto-clean card's rows are settings.json
// (storage:*).

import { pushToast } from "@/app/cockpit/notificationstore";
import { getSettingsKeyAtom } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { showCanvases } from "../agentcenter";
import type { AgentsViewModel } from "../agents";
import { formatAgo } from "../agentsviewmodel";
import { CardFooter, Segmented, SettingCard, SettingRow, Toggle, writeConfig } from "../settingsui";
import {
    buildProjectRows,
    CARD_COPY,
    CARD_ORDER,
    cleanableTotal,
    cleanAllIds,
    cleanToast,
    confirmFor,
    DEFAULT_NUDGE_GB,
    DEFAULT_SESSION_DAYS,
    formatSize,
    lastUsedText,
    NUDGE_GB_CHOICES,
    SESSION_DAYS,
    storageCards,
    usedTotal,
    type SessionDays,
    type StorageCard,
    type StorageRow,
} from "../storagemodel";
import {
    cleanStorage,
    rescanStorage,
    storageCleaningAtom,
    storageSkippedAtom,
    useStorageReport,
} from "../storagestore";
import { VaultCard } from "./general";

type Category = (typeof CARD_ORDER)[number];

const BUTTON =
    "inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-sm border border-edge-mid px-2.5 py-1 text-[12px] font-semibold text-ink-mid transition-colors hover:bg-surface-hover hover:text-primary disabled:cursor-default disabled:opacity-50";
const ROWS_SHOWN = 5;
// the cards whose head counts their rows, in the singular and the plural
const COUNT_NOUN: Partial<Record<Category, [string, string]>> = {
    sessions: ["session", "sessions"],
    canvases: ["canvas", "canvases"],
};

// one line of a card: an item, or for build output a project, which opens onto its folders
type Entry = {
    id: string;
    label: string;
    title?: string;
    detail?: string;
    detailTitle?: string;
    bytes: number;
    why?: string;
    warn: boolean;
    onRemove?: () => void;
    busy: boolean; // a clean is removing it now
    folders?: Entry[];
};

function runClean(card: StorageCard, rows: StorageRow[], days: SessionDays, guarded: boolean) {
    const c = confirmFor(card, rows, days, guarded);
    modalsModel.pushModal("ConfirmModal", {
        title: c.title,
        message: c.message,
        confirmLabel: c.confirmLabel,
        destructive: true,
        onConfirm: () =>
            fireAndForget(async () => {
                try {
                    const result = await cleanStorage(
                        card.category,
                        rows.map((r) => r.id),
                        {
                            olderthandays: card.category === "sessions" ? Number(days) : undefined,
                            allowguarded: guarded || undefined,
                        }
                    );
                    pushToast({
                        title: "Storage",
                        message: cleanToast(result),
                        level: result.skipped?.length ? "warn" : "info",
                    });
                } catch (e) {
                    pushToast({ title: "Storage", message: `Couldn't clean: ${String(e)}`, level: "error" });
                }
            }),
    });
}

function entriesOf(
    category: Category,
    card: StorageCard | null,
    days: SessionDays,
    now: number,
    cleaning: Record<string, true>
): Entry[] {
    // canvases are listed and cleaned in the gallery; here they are a size and a count
    if (card == null || category === "canvases") {
        return [];
    }
    if (category === "buildoutput") {
        // cleaned per project (spec 4.4): one row and one button each, the row opening onto each folder and its own
        // button; a busy project's row says why it stays
        return buildProjectRows(card).map((p) => ({
            id: p.project,
            label: p.name,
            title: p.project,
            detail: lastUsedText(p.lastUsed, now),
            detailTitle: p.dirs.join(", "),
            bytes: p.bytes,
            why: p.reason ?? p.skipped,
            warn: false,
            busy: p.ids.some((id) => cleaning[id]),
            onRemove:
                p.ids.length > 0
                    ? () =>
                          runClean(
                              card,
                              card.rows.filter((r) => p.ids.includes(r.id)),
                              days,
                              false
                          )
                    : undefined,
            folders: p.folders.map((r) => ({
                id: r.id,
                label: r.label,
                title: r.path,
                bytes: r.bytes,
                why: r.skipped,
                warn: r.skipped != null,
                busy: !!cleaning[r.id],
                onRemove: r.cleanable ? () => runClean(card, [r], days, false) : undefined,
            })),
        }));
    }
    return card.rows.map((r) => ({
        id: r.id,
        label: r.label,
        detail: r.detail,
        bytes: r.bytes,
        why: r.reason ?? r.skipped,
        warn: !!r.guarded || r.skipped != null,
        busy: !!cleaning[r.id],
        // a run worktree and a package cache have their own button; a guarded tree's confirm says what is lost
        onRemove:
            (category === "runworktrees" && (r.cleanable || r.guarded)) || (category === "packagecaches" && r.cleanable)
                ? () => runClean(card, [r], days, !!r.guarded)
                : undefined,
    }));
}

function Busy({ label }: { label: string }) {
    return (
        <>
            <Loader2 size={12} aria-hidden className="animate-spin motion-reduce:animate-none" />
            {label}
        </>
    );
}

function EntryRow({ e, nested }: { e: Entry; nested?: boolean }) {
    const [open, setOpen] = useState(false);
    const opens = e.folders != null && e.folders.length > 0;
    return (
        <>
            <div
                data-storage-row={e.id}
                data-storage-folder={nested ? "" : undefined}
                className={cn(
                    "flex min-w-0 items-center gap-3 border-t border-edge-mid py-2 text-[12px]",
                    nested ? "pr-4 pl-10" : "px-4"
                )}
            >
                {opens ? (
                    <button
                        type="button"
                        data-storage-open={open ? "" : undefined}
                        title={e.title ?? e.label}
                        aria-expanded={open}
                        onClick={() => setOpen(!open)}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-primary"
                    >
                        <ChevronRight
                            size={12}
                            aria-hidden
                            className={cn("flex-none text-ink-faint transition-transform", open && "rotate-90")}
                        />
                        <span className="min-w-0 truncate">{e.label}</span>
                    </button>
                ) : (
                    <span
                        title={e.title ?? e.label}
                        className={cn("min-w-0 flex-1 truncate", nested ? "text-secondary" : "text-primary")}
                    >
                        {e.label}
                    </span>
                )}
                {e.detail ? (
                    <span
                        title={e.detailTitle ?? e.detail}
                        className="min-w-0 max-w-[220px] shrink truncate text-muted"
                    >
                        {e.detail}
                    </span>
                ) : null}
                <span className="w-[64px] flex-none text-right tabular-nums text-muted">{formatSize(e.bytes)}</span>
                {e.why ? (
                    <span data-storage-reason className={cn("flex-none", e.warn ? "text-warning" : "text-muted")}>
                        {e.why}
                    </span>
                ) : null}
                {e.onRemove ? (
                    <button
                        type="button"
                        data-storage-remove
                        data-storage-busy={e.busy ? "" : undefined}
                        className={BUTTON}
                        disabled={e.busy}
                        onClick={e.onRemove}
                    >
                        {e.busy ? <Busy label="Removing…" /> : "Remove"}
                    </button>
                ) : null}
            </div>
            {open ? e.folders?.map((f) => <EntryRow key={f.id} e={f} nested />) : null}
        </>
    );
}

function CategoryCard({
    category,
    card,
    days,
    onDays,
    model,
    now,
}: {
    category: Category;
    card: StorageCard | null;
    days: SessionDays;
    onDays: (d: SessionDays) => void;
    model: AgentsViewModel;
    now: number;
}) {
    const [open, setOpen] = useState(false);
    const copy = CARD_COPY[category];
    const noun = COUNT_NOUN[category];
    const cleaning = useAtomValue(storageCleaningAtom);
    const entries = entriesOf(category, card, days, now, cleaning);
    const shown = open ? entries : entries.slice(0, ROWS_SHOWN);
    const ids = card != null ? cleanAllIds(card) : [];
    const cleaningAll = ids.some((id) => cleaning[id]);
    return (
        <SettingCard
            id={category}
            label={copy.title}
            footer={
                entries.length > ROWS_SHOWN ? (
                    <CardFooter>
                        <button
                            type="button"
                            data-storage-more
                            onClick={() => setOpen(!open)}
                            className="cursor-pointer text-[12px] font-semibold text-secondary transition-colors hover:text-primary"
                        >
                            {open ? "Show fewer" : `Show all ${entries.length}`}
                        </button>
                    </CardFooter>
                ) : undefined
            }
        >
            <div className="flex flex-col gap-1 px-4 py-3">
                <div className="flex min-h-[26px] items-center gap-3">
                    <span className="text-[13px] font-semibold tabular-nums text-primary">
                        {card == null ? "…" : formatSize(card.bytes)}
                    </span>
                    {noun != null && card != null ? (
                        <span data-storage-count={card.rows.length} className="text-[12px] text-muted">
                            {card.rows.length} {noun[card.rows.length === 1 ? 0 : 1]}
                        </span>
                    ) : null}
                    <span className="flex-1" />
                    {category === "canvases" ? (
                        <button
                            type="button"
                            data-storage-canvases-open
                            className={BUTTON}
                            onClick={() => showCanvases(model)}
                        >
                            Open the gallery
                        </button>
                    ) : null}
                    {category === "sessions" ? (
                        <Segmented<SessionDays>
                            options={SESSION_DAYS.map((d) => ({ id: d, label: `${d} days` }))}
                            value={days}
                            onChange={onDays}
                        />
                    ) : null}
                    {copy.action != null && card != null ? (
                        <button
                            type="button"
                            data-storage-clean={category}
                            data-storage-busy={cleaningAll ? "" : undefined}
                            className={BUTTON}
                            disabled={ids.length === 0 || cleaningAll}
                            onClick={() =>
                                runClean(
                                    card,
                                    card.rows.filter((r) => ids.includes(r.id)),
                                    days,
                                    false
                                )
                            }
                        >
                            {cleaningAll ? (
                                <Busy label="Cleaning…" />
                            ) : (
                                <>
                                    {copy.action}
                                    {ids.length > 0 ? ` · ${formatSize(card.cleanableBytes)}` : ""}
                                </>
                            )}
                        </button>
                    ) : null}
                </div>
                <div className="text-[12px] leading-[1.45] text-muted">{copy.blurb}</div>
                {card?.error ? (
                    <div data-storage-error className="flex items-center gap-2 text-[12px] text-warning">
                        <span className="min-w-0 flex-1">Couldn't scan: {card.error}</span>
                        <button type="button" data-storage-rescan={category} className={BUTTON} onClick={rescanStorage}>
                            Rescan
                        </button>
                    </div>
                ) : null}
            </div>
            {shown.map((e) => (
                <EntryRow key={e.id} e={e} />
            ))}
        </SettingCard>
    );
}

export function StoragePage({ model }: { model: AgentsViewModel }) {
    const report = useStorageReport(true);
    const skipped = useAtomValue(storageSkippedAtom);
    const [days, setDays] = useState<SessionDays>(DEFAULT_SESSION_DAYS);
    const auto = (useAtomValue(getSettingsKeyAtom("storage:autoclean")) as boolean | undefined) ?? true;
    const nudge = (useAtomValue(getSettingsKeyAtom("storage:nudgegb")) as number | undefined) ?? DEFAULT_NUDGE_GB;
    const canvasOnShip = (useAtomValue(getSettingsKeyAtom("storage:canvasonship")) as boolean | undefined) ?? false;
    const now = Date.now();
    const cards = storageCards(report, days, now, skipped);
    const scanned = report != null && report.scannedts > 0;
    // before the first scan the head keeps its shape, with … for the sizes and Scanning… for the time
    const scanning = report == null || report.scanning || !scanned;
    const size = (n: number) => (scanned ? formatSize(n) : "…");
    return (
        <>
            <div
                data-storage-head
                data-storage-scanned={report?.scannedts ?? 0}
                data-storage-scanning={scanning ? "" : undefined}
                className="flex items-center gap-3"
            >
                <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-primary">
                    arcterm uses {size(usedTotal(report))} · {size(cleanableTotal(report, days, now))} can be cleaned
                </span>
                <span className="flex-none text-[12px] text-muted">
                    {scanning ? "Scanning…" : `scanned ${formatAgo(now - (report?.scannedts ?? now))}`}
                </span>
                <button
                    type="button"
                    data-storage-rescan="head"
                    className={BUTTON}
                    disabled={scanning}
                    onClick={rescanStorage}
                >
                    Rescan
                </button>
            </div>
            <VaultCard />
            {CARD_ORDER.map((cat) => (
                <CategoryCard
                    key={cat}
                    category={cat}
                    card={cards.find((c) => c.category === cat) ?? null}
                    days={days}
                    onDays={setDays}
                    model={model}
                    now={now}
                />
            ))}
            <SettingCard
                id="autoclean"
                label="Auto-clean"
                footer={
                    report?.lastauto ? (
                        <CardFooter dot>
                            <span data-storage-lastauto>
                                Last auto-clean {formatAgo(now - report.lastauto.ts)}: reclaimed{" "}
                                {formatSize(report.lastauto.reclaimed)}
                                {report.lastauto.error ? ` · ${report.lastauto.error}` : ""}
                            </span>
                        </CardFooter>
                    ) : undefined
                }
            >
                <SettingRow id="storage.autoclean">
                    <Toggle
                        on={auto}
                        onToggle={() => writeConfig({ "storage:autoclean": !auto })}
                        label="Clean the safe parts daily"
                    />
                </SettingRow>
                <SettingRow id="storage.nudge">
                    <Segmented<string>
                        options={NUDGE_GB_CHOICES.map((v) => ({ id: v, label: `${v} GB` }))}
                        value={String(nudge)}
                        onChange={(v) => writeConfig({ "storage:nudgegb": Number(v) })}
                    />
                </SettingRow>
                <SettingRow id="storage.canvasonship">
                    <Toggle
                        on={canvasOnShip}
                        onToggle={() => writeConfig({ "storage:canvasonship": !canvasOnShip })}
                        label="Agents delete a canvas when its feature ships"
                    />
                </SettingRow>
            </SettingCard>
        </>
    );
}
