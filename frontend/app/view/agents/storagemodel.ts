// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: Settings → Storage as data. Orders the categories pkg/storage reports into cards, applies the sessions
// card's age, folds build output into projects (the longest unused first), joins the reasons a clean skipped onto
// their rows, words the confirms and the toasts, and decides when the nudge shows. settingspages/storage.tsx draws
// it; storagenudge.tsx toasts it. No React, no store.

export const SESSION_DAYS = ["7", "30", "90"] as const;
export type SessionDays = (typeof SESSION_DAYS)[number];
export const DEFAULT_SESSION_DAYS: SessionDays = "30";
export const NUDGE_GB_CHOICES = ["1", "2", "5", "10"] as const;
export const DEFAULT_NUDGE_GB = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
// Decimal units, as Finder and System Settings count a disk.
const KB = 1000;
const MB = 1000 * KB;
const GB = 1000 * MB;

export const CARD_ORDER = [
    "runworktrees",
    "sessions",
    "housekeeping",
    "buildoutput",
    "packagecaches",
    "canvases",
] as const;

/** The cards for what the whole machine shares, not arcterm: the head's totals, the nudge and the tray leave them out. */
export const SHARED_CATEGORIES: ReadonlySet<string> = new Set(["packagecaches"]);

export const CARD_COPY: Record<(typeof CARD_ORDER)[number], { title: string; blurb: string; action: string | null }> = {
    runworktrees: {
        title: "Run worktrees",
        blurb: "Trees that finished orchestrator runs left in arc-wt or .waveterm/worktrees. Their branches stay.",
        action: "Clean all",
    },
    sessions: {
        title: "Old Claude sessions",
        blurb: "Transcripts not touched in a while. They go to ~/.arc/trash for 7 days, then for good.",
        action: "Move to trash",
    },
    housekeeping: {
        title: "Logs, cache and trash",
        blurb: "Rolled logs, the session trash, the images sent with a new agent's task and the interface's cache.",
        action: "Clean",
    },
    buildoutput: {
        title: "Build output",
        blurb: "node_modules, target, dist and the like that git ignores in your projects and in the repos agents worked in, the longest unused first. The next build or install recreates them.",
        action: null,
    },
    packagecaches: {
        title: "Package caches",
        blurb: "What npm, Go, Cargo, Homebrew and the like downloaded or built once, shared by every project on this machine, so the total above leaves them out. The next install or build fetches what it needs again.",
        action: null,
    },
    canvases: {
        title: "Design canvases",
        blurb: "Mockups agents drew with design-local, in each project's .superpowers/design. They stay until you clean them up in the gallery, where you see each one before it goes to ~/.arc/trash for 7 days.",
        action: null,
    },
};

export type StorageRow = StorageItem & { skipped?: string };

export type StorageCard = {
    category: string;
    title: string;
    blurb: string;
    action: string | null; // the card's own button; null for build output, cleaned row by row
    bytes: number;
    cleanableBytes: number;
    rows: StorageRow[];
    error?: string;
};

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const isCleanAll = (r: StorageItem) => r.cleanable && !r.guarded;

/** The sessions older than the card's age; an item without a time counts as old. */
export function sessionRows(items: StorageItem[], days: SessionDays, nowMs: number): StorageItem[] {
    const cutoff = nowMs - Number(days) * DAY_MS;
    return items.filter((i) => (i.modts ?? 0) <= cutoff);
}

export function storageCards(
    report: StorageReport | null,
    days: SessionDays,
    nowMs: number,
    skipped: Record<string, string>
): StorageCard[] {
    if (report == null) {
        return [];
    }
    const byCat = new Map((report.categories ?? []).map((c) => [c.category, c]));
    return CARD_ORDER.flatMap((cat) => {
        const c = byCat.get(cat);
        if (c == null) {
            return [];
        }
        const items = cat === "sessions" ? sessionRows(c.items ?? [], days, nowMs) : (c.items ?? []);
        // A clean's skip reason is older news than the scan's own reason, so a row that has one shows that instead.
        const rows: StorageRow[] = items.map((i) =>
            skipped[i.id] && !i.reason ? { ...i, skipped: skipped[i.id] } : i
        );
        return [
            {
                category: cat,
                ...CARD_COPY[cat],
                bytes: sum(rows.map((r) => r.bytes)),
                cleanableBytes: sum(rows.filter(isCleanAll).map((r) => r.bytes)),
                rows,
                error: c.error || undefined,
            },
        ];
    });
}

/** What the card's own button cleans: its cleanable rows that need no stronger confirm. */
export function cleanAllIds(card: StorageCard): string[] {
    return card.rows.filter(isCleanAll).map((r) => r.id);
}

/** Build output's rows: one per project, holding its folders; its one button cleans `ids`, and opened it lists `folders`. */
export type BuildProjectRow = {
    project: string;
    name: string;
    dirs: string[];
    folders: StorageRow[]; // the largest first
    bytes: number;
    ids: string[]; // the folders a clean may take now; empty while something runs in the project
    lastUsed: number; // unix ms an agent last worked in it, 0 when none did
    reason?: string;
    skipped?: string;
};

/** A path's last segment, either separator, a trailing one ignored. */
export function projectName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function buildProjectRows(card: StorageCard): BuildProjectRow[] {
    const byProject = new Map<string, StorageRow[]>();
    for (const r of card.rows) {
        const key = r.detail ?? "";
        byProject.set(key, [...(byProject.get(key) ?? []), r]);
    }
    const out: BuildProjectRow[] = [...byProject].map(([project, rows]) => ({
        project,
        name: projectName(project),
        dirs: rows.map((r) => r.label),
        folders: [...rows].sort((a, b) => b.bytes - a.bytes),
        bytes: sum(rows.map((r) => r.bytes)),
        ids: rows.filter((r) => r.cleanable).map((r) => r.id),
        lastUsed: Math.max(0, ...rows.map((r) => r.modts ?? 0)),
        reason: rows.find((r) => r.reason)?.reason,
        skipped: rows.find((r) => r.skipped)?.skipped,
    }));
    // the longest unused first, where what to clean usually is; then the largest
    return out.sort((a, b) => a.lastUsed - b.lastUsed || b.bytes - a.bytes);
}

/** When an agent last worked in a build output project, for its row. */
export function lastUsedText(lastUsed: number, nowMs: number): string {
    if (lastUsed <= 0) {
        return "no agent session";
    }
    const days = Math.floor((nowMs - lastUsed) / DAY_MS);
    if (days < 1) {
        return "used today";
    }
    if (days < 60) {
        return `used ${days} day${days === 1 ? "" : "s"} ago`;
    }
    return `used ${Math.round(days / 30)} months ago`;
}

export function cleanableTotal(report: StorageReport | null, days: SessionDays, nowMs: number): number {
    return sum(
        storageCards(report, days, nowMs, {})
            .filter((c) => !SHARED_CATEGORIES.has(c.category))
            .map((c) => c.cleanableBytes)
    );
}

/** Everything the scan saw but the shared caches, arcterm's store included. */
export function usedTotal(report: StorageReport | null): number {
    if (report == null) {
        return 0;
    }
    const own = (report.categories ?? []).filter((c) => !SHARED_CATEGORIES.has(c.category));
    return sum(own.map((c) => c.bytes)) + (report.storebytes ?? 0);
}

/** The report once a clean has taken `cleaned`: those items gone, their bytes off their category, and a scan under
 *  way, which pkg/storage starts after every clean and whose report replaces this one. */
export function withoutCleaned(report: StorageReport, cleaned: string[]): StorageReport {
    const gone = new Set(cleaned);
    return {
        ...report,
        scanning: true,
        categories: (report.categories ?? []).map((c) => {
            const taken = (c.items ?? []).filter((i) => gone.has(i.id));
            if (taken.length === 0) {
                return c;
            }
            const cleanable = taken.filter((i) => i.cleanable);
            return {
                ...c,
                bytes: Math.max(0, c.bytes - sum(taken.map((i) => i.bytes))),
                cleanablebytes: Math.max(0, c.cleanablebytes - sum(cleanable.map((i) => i.bytes))),
                items: c.items.filter((i) => !gone.has(i.id)),
            };
        }),
    };
}

export function shouldNudge(cleanableBytes: number, nudgeGb: number, lastDay: string | null, today: string): boolean {
    return nudgeGb > 0 && cleanableBytes > nudgeGb * GB && lastDay !== today;
}

/** The local date, YYYY-MM-DD: the nudge's once-a-day key. */
export function dayKey(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatSize(bytes: number): string {
    if (bytes < MB) {
        return `${Math.round(bytes / KB)} KB`;
    }
    if (bytes < GB) {
        return `${Math.round(bytes / MB)} MB`;
    }
    return `${Number((bytes / GB).toFixed(1))} GB`;
}

export function cleanToast(result: StorageCleanResult): string {
    const parts: string[] = [];
    if (result.reclaimed > 0) {
        parts.push(`Reclaimed ${formatSize(result.reclaimed)}`);
    }
    if ((result.trashed ?? 0) > 0) {
        parts.push(`Moved ${formatSize(result.trashed ?? 0)} to the trash`);
    }
    if (result.deferred) {
        parts.push("The interface cache clears when arcterm next opens");
    }
    let text = parts.length > 0 ? parts.join(". ") : "Nothing was cleaned";
    const skipped = result.skipped?.length ?? 0;
    if (skipped > 0) {
        text += `; ${skipped} skipped`;
    }
    return text;
}

export function skippedOf(result: StorageCleanResult): Record<string, string> {
    return Object.fromEntries((result.skipped ?? []).map((s) => [s.id, s.reason]));
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The confirm a clean opens: what goes, how much, and what it costs. */
export function confirmFor(
    card: StorageCard,
    rows: StorageRow[],
    days: SessionDays,
    guarded: boolean
): { title: string; message: string; confirmLabel: string } {
    const size = formatSize(sum(rows.map((r) => r.bytes)));
    switch (card.category) {
        case "runworktrees":
            return guarded
                ? {
                      title: "Remove run worktree",
                      message: `Remove run worktree ${rows[0]?.label ?? ""} (${size})? It has uncommitted changes, which are lost. Its branch stays.`,
                      confirmLabel: "Remove",
                  }
                : {
                      title: "Clean run worktrees",
                      message: `Remove ${plural(rows.length, "run worktree")} (${size})? Their branches stay.`,
                      confirmLabel: "Remove",
                  };
        case "sessions":
            return {
                title: "Move sessions to the trash",
                message: `Move ${plural(rows.length, "session")} older than ${days} days (${size}) to ~/.arc/trash? They are removed for good after 7 days and no longer resume with claude --resume.`,
                confirmLabel: "Move to trash",
            };
        case "housekeeping":
            return {
                title: "Clean logs, cache and trash",
                message: `Remove rolled logs, empty the session trash for good and remove the images sent at launch (${size})? Their transcripts no longer show those images. The interface cache clears when arcterm next opens.`,
                confirmLabel: "Clean",
            };
        case "packagecaches":
            return {
                title: "Remove package cache",
                message: `Remove the ${rows[0]?.label ?? "cache"} (${size})? Every project on this machine shares it: the next install or build fetches or rebuilds what it needs, slower that once.`,
                confirmLabel: "Remove",
            };
        default:
            return {
                title: "Remove build output",
                message: `Remove the build output of ${projectName(rows[0]?.detail ?? "")} (${size}): ${rows.map((r) => r.label).join(", ")}? The next build or install recreates it.`,
                confirmLabel: "Remove",
            };
    }
}
