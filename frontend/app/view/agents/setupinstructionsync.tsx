// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Instructions tab's additions from the kaeltran16 fork (its ce7a5fecd), kept out of setupsurface.tsx: Sync now
// with the dry run's counts, a harness row's note in the tone the backend gave it, what an outside edit changed in
// the conflict notice, and a read-only preview of one harness file. setupsurface.tsx hooks them in; the tab's own
// editor and save are untouched. The logic is in setupmodel.ts, the RPCs and atoms in setupstore.ts.

import { globalStore } from "@/app/store/jotaiStore";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useCallback, type KeyboardEvent } from "react";
import {
    diskChanges,
    needsSync,
    syncBreakdown,
    syncDoneText,
    syncPlanText,
    type DocEditor,
    type Tone,
} from "./setupmodel";
import {
    setupBusyAtom,
    setupHarnessPreviewAtom,
    setupSharedDiskAtom,
    setupStatusAtom,
    setupSyncAtom,
    syncNow,
} from "./setupstore";
import { BTN_SECONDARY } from "./setupstyles";
import { useFileText } from "./usefiletext";

export const TONE_DOT: Record<Tone, string> = { ok: "bg-success", warn: "bg-warning", none: "bg-ink-faint" };
export const TONE_TEXT: Record<Tone, string> = { ok: "text-ink-mid", warn: "text-warning-soft", none: "text-muted" };

// the lines of an outside edit the conflict notice lists before it says "+N more"
const MAX_DISK_LINES = 8;

// Ctrl+S (Cmd+S on a Mac) in an editor saves it: a key handler on the textarea, no global binding
export function isSaveKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): boolean {
    return e.key.toLowerCase() === "s" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
}

// beside the header status: what is behind, what Sync now would write (the dry run's counts, once it ran) and the
// button. It shows while a present harness lacks the doc, and the result stays after the write settles it.
export function SyncNow() {
    const rows = useAtomValue(setupStatusAtom)?.harnesses ?? [];
    const result = useAtomValue(setupSyncAtom);
    const busy = useAtomValue(setupBusyAtom);
    const need = needsSync(rows);
    const breakdown = syncBreakdown(rows);
    if (!need && result == null) {
        return null;
    }
    return (
        <div data-sync-now className="flex items-center gap-2.5">
            {result != null ? (
                <span data-sync-result={result.phase} role="status" className="text-[12px] text-ink-mid">
                    {result.phase === "writing" ? syncPlanText(result.plan) : syncDoneText(result.plan)}
                </span>
            ) : breakdown != null ? (
                <span data-sync-breakdown className="text-[12px] text-muted">
                    {breakdown}
                </span>
            ) : null}
            {need ? (
                <button
                    type="button"
                    data-sync-now-button
                    disabled={busy}
                    onClick={() => fireAndForget(syncNow)}
                    className={cn(BTN_SECONDARY, "h-8 text-[13px]")}
                >
                    {busy ? "Syncing…" : "Sync now"}
                </button>
            ) : null}
        </div>
    );
}

// A harness row's note (Pi's, today) under its state line, in the tone the backend set: the text is never read.
export function HarnessNote({ row }: { row: AgentSyncHarness }) {
    if (!row.note) {
        return null;
    }
    const tone: Tone = row.notetone === "warn" ? "warn" : "ok";
    return (
        <span
            data-harness-note={row.runtime}
            data-note-tone={tone}
            className={cn("mt-0.5 text-[11px] leading-[1.4]", TONE_TEXT[tone])}
        >
            {row.note}
        </span>
    );
}

function LineList({ lines, sign, label }: { lines: string[]; sign: "+" | "−"; label: string }) {
    if (lines.length === 0) {
        return null;
    }
    const shown = lines.slice(0, MAX_DISK_LINES);
    return (
        <div data-conflict-disk-lines={label} className="flex flex-col gap-0.5">
            <span className="text-[11px] font-semibold text-muted">{label}</span>
            {shown.map((l, i) => (
                <span key={i} className="flex gap-1.5 font-mono text-[11.5px] text-secondary [overflow-wrap:anywhere]">
                    <span aria-hidden className="flex-none text-muted">
                        {sign}
                    </span>
                    {l}
                </span>
            ))}
            {lines.length > shown.length ? (
                <span className="text-[11px] text-muted">+{lines.length - shown.length} more</span>
            ) : null}
        </div>
    );
}

// Under the conflict notice: the lines the version on disk adds and drops against what the editor loaded, or that
// it could not be read. Reload and Overwrite stay the way out either way.
export function ConflictDiskChanges({ ed }: { ed: DocEditor }) {
    const disk = useAtomValue(setupSharedDiskAtom);
    if (!ed.conflict || disk == null) {
        return null;
    }
    const box = "flex flex-col gap-2 rounded border border-border bg-surface px-3.5 py-2.5 text-[12px] text-ink-mid";
    if (disk.text == null) {
        return (
            <div data-conflict-disk="unreadable" className={box}>
                The version on disk could not be read, so what changed is not shown.
            </div>
        );
    }
    const { added, dropped } = diskChanges(ed.base, disk.text);
    if (added.length === 0 && dropped.length === 0) {
        return (
            <div data-conflict-disk="same" className={box}>
                The version on disk has the same lines; only its save time moved.
            </div>
        );
    }
    const lines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;
    const what = [
        added.length > 0 ? `gained ${lines(added.length)}` : null,
        dropped.length > 0 ? `lost ${lines(dropped.length)}` : null,
    ]
        .filter(Boolean)
        .join(" and ");
    return (
        <div data-conflict-disk="changes" className={box}>
            <span>
                Outside your editor the file {what}.{added.length > 0 ? " Overwrite drops what it gained." : ""}
            </span>
            <LineList lines={added} sign="+" label="On disk, not in your editor's base" />
            <LineList lines={dropped} sign="−" label="In your editor's base, gone from disk" />
        </div>
    );
}

// The center of the Instructions tab while a harness row is picked: that harness's file, read-only. The shared
// editor's draft lives in an atom, so it is exactly as it was when the Shared row brings the editor back.
export function HarnessPreview({ row }: { row: AgentSyncHarness }) {
    const [file] = useFileText(row.path);
    const back = useCallback(() => globalStore.set(setupHarnessPreviewAtom, null), []);
    return (
        <div data-harness-preview={row.runtime} className="flex min-w-0 flex-1 flex-col gap-3 px-5 pb-5 pt-4">
            <div className="flex items-center gap-3.5">
                <div className="flex min-w-0 flex-col gap-[3px]">
                    <div className="text-[15px] font-semibold text-primary">{row.label}</div>
                    <div title={row.path} className="truncate text-[12px] text-muted">
                        {row.path}
                    </div>
                </div>
                <div className="flex-1" />
                <span className="flex-none text-[12px] text-muted">Read-only</span>
                <button type="button" data-harness-preview-back onClick={back} className={BTN_SECONDARY}>
                    Back to the shared doc
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded border border-edge-mid bg-surface-code px-4 py-3">
                {file.status === "ok" ? (
                    <pre className="m-0 whitespace-pre-wrap font-mono text-[12.5px] leading-[21px] text-secondary [overflow-wrap:anywhere]">
                        {file.text}
                    </pre>
                ) : (
                    <div className="text-[12.5px] text-muted">
                        {file.status === "loading" ? "Reading…" : `Could not read ${row.path}. It is missing or empty.`}
                    </div>
                )}
            </div>
        </div>
    );
}
