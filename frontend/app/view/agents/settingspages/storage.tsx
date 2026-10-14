// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Storage: what arcterm and its agents leave on disk, per category, and cleaning it. storagemodel.ts
// decides what each card holds and says; pkg/storage measures and cleans, re-checking every rule at removal. The
// head and the four category cards read the storage report; the Auto-clean card's rows are settings.json
// (storage:*).

import { pushToast } from "@/app/cockpit/notificationstore";
import { getSettingsKeyAtom } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useState } from "react";
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
    NUDGE_GB_CHOICES,
    SESSION_DAYS,
    storageCards,
    usedTotal,
    type SessionDays,
    type StorageCard,
    type StorageRow,
} from "../storagemodel";
import { cleanStorage, rescanStorage, storageSkippedAtom, useStorageReport } from "../storagestore";

type Category = (typeof CARD_ORDER)[number];

const BUTTON =
    "flex-none cursor-pointer rounded-sm border border-edge-mid px-2.5 py-1 text-[12px] font-semibold text-ink-mid transition-colors hover:bg-surface-hover hover:text-primary disabled:cursor-default disabled:opacity-50";
const ROWS_SHOWN = 5;

// one line of a card: an item, or for build output a project
type Entry = {
    id: string;
    label: string;
    title?: string;
    detail?: string;
    bytes: number;
    why?: string;
    warn: boolean;
    onRemove?: () => void;
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

function entriesOf(category: Category, card: StorageCard | null, days: SessionDays): Entry[] {
    if (card == null) {
        return [];
    }
    if (category === "buildoutput") {
        // cleaned per project (spec 4.4): one row and one button each; a busy project's row says why it stays
        return buildProjectRows(card).map((p) => ({
            id: p.project,
            label: p.name,
            title: p.project,
            detail: p.dirs.join(", "),
            bytes: p.bytes,
            why: p.reason ?? p.skipped,
            warn: false,
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
        }));
    }
    return card.rows.map((r) => ({
        id: r.id,
        label: r.label,
        detail: r.detail,
        bytes: r.bytes,
        why: r.reason ?? r.skipped,
        warn: !!r.guarded || r.skipped != null,
        // a run worktree has its own button; a guarded one's confirm says what is lost
        onRemove:
            category === "runworktrees" && (r.cleanable || r.guarded)
                ? () => runClean(card, [r], days, !!r.guarded)
                : undefined,
    }));
}

function EntryRow({ e }: { e: Entry }) {
    return (
        <div
            data-storage-row={e.id}
            className="flex min-w-0 items-center gap-3 border-t border-edge-mid px-4 py-2 text-[12px]"
        >
            <span title={e.title ?? e.label} className="min-w-0 flex-1 truncate text-primary">
                {e.label}
            </span>
            {e.detail ? (
                <span title={e.detail} className="min-w-0 max-w-[220px] shrink truncate text-muted">
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
                <button type="button" data-storage-remove className={BUTTON} onClick={e.onRemove}>
                    Remove
                </button>
            ) : null}
        </div>
    );
}

function CategoryCard({
    category,
    card,
    days,
    onDays,
}: {
    category: Category;
    card: StorageCard | null;
    days: SessionDays;
    onDays: (d: SessionDays) => void;
}) {
    const [open, setOpen] = useState(false);
    const copy = CARD_COPY[category];
    const entries = entriesOf(category, card, days);
    const shown = open ? entries : entries.slice(0, ROWS_SHOWN);
    const ids = card != null ? cleanAllIds(card) : [];
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
                    {category === "sessions" && card != null ? (
                        <span data-storage-count={card.rows.length} className="text-[12px] text-muted">
                            {card.rows.length === 1 ? "1 session" : `${card.rows.length} sessions`}
                        </span>
                    ) : null}
                    <span className="flex-1" />
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
                            className={BUTTON}
                            disabled={ids.length === 0}
                            onClick={() =>
                                runClean(
                                    card,
                                    card.rows.filter((r) => ids.includes(r.id)),
                                    days,
                                    false
                                )
                            }
                        >
                            {copy.action}
                            {ids.length > 0 ? ` · ${formatSize(card.cleanableBytes)}` : ""}
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

export function StoragePage() {
    const report = useStorageReport(true);
    const skipped = useAtomValue(storageSkippedAtom);
    const [days, setDays] = useState<SessionDays>(DEFAULT_SESSION_DAYS);
    const auto = (useAtomValue(getSettingsKeyAtom("storage:autoclean")) as boolean | undefined) ?? true;
    const nudge = (useAtomValue(getSettingsKeyAtom("storage:nudgegb")) as number | undefined) ?? DEFAULT_NUDGE_GB;
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
            {CARD_ORDER.map((cat) => (
                <CategoryCard
                    key={cat}
                    category={cat}
                    card={cards.find((c) => c.category === cat) ?? null}
                    days={days}
                    onDays={setDays}
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
            </SettingCard>
        </>
    );
}
