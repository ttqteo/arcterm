// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A council message's evidence as compact chips, one per cited file with its lines after it, two at most and the rest
// folded into `+N files`, and the Sources panel a click opens on the right of the chat, in place of the thread panel
// (A-links-panel.dc.html in the council-evidence-chips canvas; the rules are in councilsources.ts). The panel lists the message's files, reads the picked one from the council's
// project and shows the cited lines lit, a line of context each side; Open in Code opens it at the first cited line.
// Escape or the close button goes back to the thread the panel was opened from. A list with no council to open (Ideas so
// far) draws the same names, not as links. Each part carries a data-council-* attribute for the CDP scenario.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { base64ToString, cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue } from "jotai";
import { FileText, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
    foldSources,
    groupSources,
    hunkLabel,
    pastEndWords,
    sourceDir,
    sourceExcerpt,
    sourceFilePath,
    type SourceGroup,
} from "./councilsources";
import { councilSourcesAtom, openCouncilSources, type CouncilSourcesView } from "./councilstore";

const NO_SOURCES = atom<CouncilSourcesView | null>(null);

// a cited file as a small chip (the editor-tab look): its icon, its name cut short in a 260px chip, its lines after it
const CHIP =
    "inline-flex h-[24px] min-w-0 max-w-[260px] items-center gap-[5px] rounded-[6px] border border-edge-mid bg-surface px-[7px] text-[12.5px]";

// the panel reads a cited file whole; past this it says so instead
const MAX_READ = 2 * 1024 * 1024;

const secondaryButton =
    "h-[26px] cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-[10px] text-[13px] text-secondary outline-none hover:border-edge-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent";
const ghostButton =
    "h-[26px] cursor-pointer rounded-[6px] border-0 bg-transparent px-[10px] text-[13px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent";

/** The message a row of evidence links belongs to, so a click opens the Sources panel on it. */
export interface SourceOwner {
    councilId: string;
    owner: string; // the idea, reply or draft id
    title: string; // what the panel's header names it by
}

/** The references a message cites, one link per file, and a claim marked weak as its own amber chip. */
export function EvidenceChips({
    evidence = [],
    weak = "",
    source,
}: {
    evidence?: string[];
    weak?: string;
    source?: SourceOwner;
}) {
    const view = useMemo(() => groupSources(evidence), [evidence]);
    const shown = useAtomValue(source != null ? councilSourcesAtom(source.councilId) : NO_SOURCES);
    if (view.groups.length === 0 && view.others.length === 0 && weak === "") {
        return null;
    }
    const picked = source != null && shown != null && shown.owner === source.owner ? shown.pick : -1;
    const fold = foldSources(view.groups);
    const open = (pick: number) =>
        source != null &&
        openCouncilSources(source.councilId, { owner: source.owner, title: source.title, refs: evidence, pick });
    return (
        <div className="flex flex-wrap items-center gap-[6px]">
            {fold.shown.map((g, i) =>
                source == null ? (
                    <SourceName key={g.path} group={g} />
                ) : (
                    <SourceLink key={g.path} group={g} picked={i === picked} onOpen={() => open(i)} />
                )
            )}
            {fold.more !== "" &&
                (source == null ? (
                    <span
                        data-council-evidence="more"
                        title={view.groups
                            .slice(fold.shown.length)
                            .map((g) => g.path + g.label)
                            .join("\n")}
                        className={cn(CHIP, "text-muted")}
                    >
                        {fold.more}
                    </span>
                ) : (
                    <button
                        type="button"
                        data-council-evidence="more"
                        data-picked={picked >= fold.shown.length ? "true" : undefined}
                        title={view.groups
                            .slice(fold.shown.length)
                            .map((g) => g.path + g.label)
                            .join("\n")}
                        onClick={() => open(fold.shown.length)}
                        className={cn(
                            CHIP,
                            "cursor-pointer text-muted outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent",
                            picked >= fold.shown.length
                                ? "border-edge-strong bg-surface-selected"
                                : "hover:bg-surface-hover"
                        )}
                    >
                        {fold.more}
                    </button>
                ))}
            {view.others.map((ref, i) => (
                <span key={`other-${i}`} data-council-evidence="other" className={cn(CHIP, "text-secondary")}>
                    {ref}
                </span>
            ))}
            {weak !== "" && (
                <span
                    data-council-evidence="weak"
                    data-weak="true"
                    className={cn(CHIP, "border-warning/40 text-warning-soft")}
                >
                    {weak}
                </span>
            )}
        </div>
    );
}

function SourceLink({ group, picked, onOpen }: { group: SourceGroup; picked: boolean; onOpen: () => void }) {
    return (
        <button
            type="button"
            data-council-evidence="ref"
            data-council-source={group.path}
            data-picked={picked ? "true" : undefined}
            title={`${group.path}${group.label}`}
            onClick={onOpen}
            className={cn(
                CHIP,
                "group cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent",
                picked ? "border-edge-strong bg-surface-selected" : "hover:bg-surface-hover"
            )}
        >
            <FileText size={12} className="flex-none text-muted" aria-hidden />
            <span className="min-w-0 truncate font-medium text-link underline-offset-2 group-hover:underline">
                {group.name}
            </span>
            {group.label !== "" && <span className="flex-none tabular-nums text-muted">{group.label}</span>}
        </button>
    );
}

function SourceName({ group }: { group: SourceGroup }) {
    return (
        <span data-council-evidence="ref" title={`${group.path}${group.label}`} className={CHIP}>
            <FileText size={12} className="flex-none text-muted" aria-hidden />
            <span className="min-w-0 truncate font-medium text-secondary">{group.name}</span>
            {group.label !== "" && <span className="flex-none tabular-nums text-muted">{group.label}</span>}
        </span>
    );
}

// a file's text; null when it is missing, a folder, too big or unreadable
async function readSourceText(path: string): Promise<string | null> {
    if (path === "") {
        return null;
    }
    try {
        const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path } });
        if (info == null || info.notfound || info.isdir || (info.size ?? 0) > MAX_READ) {
            return null;
        }
        const data = await RpcApi.FileReadCommand(TabRpcClient, { info: { path } });
        return data?.data64 != null ? base64ToString(data.data64) : null;
    } catch {
        return null;
    }
}

type SourceText = { state: "loading" } | { state: "unreadable" } | { state: "ok"; text: string };

// the file at `path`, read again each time the panel picks it
function useSourceText(path: string): SourceText {
    const [got, setGot] = useState<{ path: string; text: string | null } | null>(null);
    useEffect(() => {
        let live = true;
        fireAndForget(async () => {
            const text = await readSourceText(path);
            if (live) {
                setGot({ path, text });
            }
        });
        return () => {
            live = false;
        };
    }, [path]);
    if (got == null || got.path !== path) {
        return { state: "loading" };
    }
    return got.text == null ? { state: "unreadable" } : { state: "ok", text: got.text };
}

/** The Sources panel: the message's files, then the picked one's cited lines. */
export function CouncilSourcesPanel({
    c,
    view,
    onClose,
    onOpenFile,
}: {
    c: Council;
    view: CouncilSourcesView;
    onClose: () => void;
    onOpenFile?: (path: string, line?: number) => void;
}) {
    const groups = useMemo(() => groupSources(view.refs).groups, [view.refs]);
    const group: SourceGroup | undefined = groups[Math.min(view.pick, groups.length - 1)];
    const abs = group == null ? "" : sourceFilePath(c.project, group.path);
    const file = useSourceText(abs);
    const text = file.state === "ok" ? file.text : null;
    const excerpt = useMemo(
        () => (text != null && group != null ? sourceExcerpt(text, group.lines) : null),
        [text, group]
    );
    const [copied, setCopied] = useState(false);
    useEffect(() => setCopied(false), [abs]);
    if (group == null) {
        return null;
    }
    const closeLabel = view.thread != null ? "Back to the thread (Esc)" : "Close the sources (Esc)";
    const dir = sourceDir(group.path);
    const past = excerpt == null ? "" : pastEndWords(excerpt);
    const copy = () =>
        fireAndForget(async () => {
            await navigator.clipboard.writeText(abs);
            setCopied(true);
        });
    return (
        <aside
            data-council-sources
            tabIndex={-1}
            aria-label="Sources"
            className="flex min-h-0 w-[440px] flex-none flex-col border-l border-edge-faint bg-surface outline-none"
        >
            <div className="flex flex-none items-center gap-[8px] border-b border-edge-faint py-[12px] pl-4 pr-3">
                <span className="text-[14px] font-semibold">Sources</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{view.title}</span>
                <button
                    type="button"
                    data-council-sources-close
                    aria-label={closeLabel}
                    title={closeLabel}
                    onClick={onClose}
                    className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <X size={14} strokeWidth={2} aria-hidden />
                </button>
            </div>
            {groups.length > 1 && (
                <div role="list" aria-label="Files" className="flex flex-none flex-col gap-[2px] p-2">
                    {groups.map((g, i) => {
                        const on = g === group;
                        return (
                            <button
                                key={g.path}
                                type="button"
                                role="listitem"
                                data-council-sources-file={g.path}
                                data-picked={on ? "true" : undefined}
                                aria-current={on ? "true" : undefined}
                                title={`${g.path}${g.label}`}
                                onClick={() => openCouncilSources(c.id, { ...view, pick: i })}
                                className={cn(
                                    "flex h-[28px] min-w-0 cursor-pointer items-center gap-[8px] rounded-[6px] border-0 px-2 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                    on ? "bg-surface-selected" : "bg-transparent hover:bg-surface-hover"
                                )}
                            >
                                <FileText size={12} className="flex-none text-muted" aria-hidden />
                                <span className={cn("min-w-0 truncate", on ? "text-primary" : "text-link")}>
                                    {g.name}
                                </span>
                                {g.label !== "" && <span className="flex-none tabular-nums text-muted">{g.label}</span>}
                            </button>
                        );
                    })}
                </div>
            )}
            <div
                data-council-sources-body
                data-state={file.state}
                className={cn(
                    "min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-[14px]",
                    groups.length > 1 && "border-t border-edge-faint"
                )}
            >
                <div className="break-all text-[16px] font-semibold leading-[1.35] text-primary">
                    {group.path.slice(dir.length)}
                </div>
                {dir !== "" && <div className="mt-[2px] break-all text-[12.5px] text-muted">{dir}</div>}
                {file.state === "loading" && <div className="mt-[14px] text-[13px] text-muted">Reading the file…</div>}
                {file.state === "unreadable" && (
                    <div data-council-sources-error className="mt-[14px] text-[13px] leading-[1.5] text-secondary">
                        Can't show this file: it is not in the project any more, it is a folder, or it is over 2 MB.
                    </div>
                )}
                {excerpt?.hunks.map((h) => (
                    <div key={h.start}>
                        <div className="mb-[6px] mt-[14px] text-[12px] text-muted">
                            {hunkLabel(h)}
                            {h.cut && " · cut short"}
                        </div>
                        <div
                            data-council-sources-hunk={h.start}
                            className="overflow-hidden rounded-[8px] border border-edge-faint bg-surface-code py-[6px]"
                        >
                            {h.rows.map((r) => (
                                <div
                                    key={r.n}
                                    data-cited={r.cited ? "true" : undefined}
                                    className={cn("flex gap-[10px] pr-[10px]", r.cited && "bg-surface-selected")}
                                >
                                    <span
                                        className={cn(
                                            "w-[34px] flex-none select-none text-right font-mono text-[12px] leading-[1.65]",
                                            r.cited ? "font-semibold text-primary" : "text-ink-faint"
                                        )}
                                    >
                                        {r.n}
                                    </span>
                                    <span className="min-w-0 flex-1 whitespace-pre-wrap font-mono text-[12.5px] leading-[1.65] text-secondary [overflow-wrap:anywhere]">
                                        {r.text === "" ? " " : r.text}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
                {past !== "" && <div className="mt-[14px] text-[13px] leading-[1.5] text-secondary">{past}</div>}
            </div>
            <div className="flex flex-none gap-2 border-t border-edge-faint px-4 py-3">
                {onOpenFile != null && file.state === "ok" && (
                    <button
                        type="button"
                        data-council-sources-open
                        onClick={() => onOpenFile(abs, group.lines[0]?.start)}
                        className={secondaryButton}
                    >
                        Open in Code
                    </button>
                )}
                <button type="button" data-council-sources-copy onClick={copy} className={ghostButton}>
                    {copied ? "Copied" : "Copy path"}
                </button>
            </div>
        </aside>
    );
}
