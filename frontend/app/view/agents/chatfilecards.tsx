// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The files you sent with a chat message, over your bubble (the chat-sent-files canvas). One file is a card: a tile with
// the file's extension, its name, and the folder it sits in with its size. Two or more are a pile: the first file's card
// in front, the next one or two tilted behind it with their names peeking out, and a line of the folder they share, the
// count and the total size. Hovering the pile fans the cards behind; a click opens it into a list, one row a file, and
// Collapse folds it back. A card or a row opens its file beside the agent as a path link does (pathlinkcontext.tsx); with
// no agent around it is only drawn. Sizes come from one FileInfoCommand a file, and a file that is gone draws struck
// through with "Not found".

import { springReveal } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { ArrowUpRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { fmtSize } from "./attachmenttray";
import {
    commonFolder,
    fileTag,
    filesShape,
    parentName,
    pileBacks,
    pileLine,
    totalBytes,
    type FileSeen,
    type FileTone,
} from "./chatfiles";
import { mentionBaseName } from "./filementiontokens";
import { usePathOpener } from "./pathlinkcontext";

const TONE_CLASS: Record<FileTone, string> = {
    pdf: "text-error",
    code: "text-accent-soft",
    data: "text-accent-soft",
    doc: "text-muted",
    other: "text-muted",
};

// what FileInfoCommand says of each path, asked once per path when the message mounts
function useFilesSeen(paths: string[]): FileSeen[] {
    const key = paths.join("\n");
    const [seen, setSeen] = useState<FileSeen[]>(() => paths.map(() => ({ status: "loading" })));
    useEffect(() => {
        let alive = true;
        const list = key.split("\n");
        setSeen(list.map(() => ({ status: "loading" })));
        list.forEach((path, i) => {
            const settle = (s: FileSeen) => {
                if (alive) {
                    setSeen((prev) => prev.map((p, j) => (j === i ? s : p)));
                }
            };
            RpcApi.FileInfoCommand(TabRpcClient, { info: { path } })
                .then((info) =>
                    settle(
                        info == null || info.notfound
                            ? { status: "missing" }
                            : { status: "found", size: info.isdir ? undefined : info.size }
                    )
                )
                .catch(() => settle({ status: "missing" }));
        });
        return () => {
            alive = false;
        };
    }, [key]);
    return seen;
}

function sizeOf(seen: FileSeen | undefined): string {
    return seen?.status === "found" && seen.size != null ? fmtSize(seen.size) : "";
}

function Tile({ name, className }: { name: string; className: string }) {
    const { tag, tone } = fileTag(name);
    return (
        <span
            aria-hidden
            className={cn(
                "flex flex-none items-center justify-center font-mono font-semibold",
                TONE_CLASS[tone],
                className
            )}
        >
            {tag}
        </span>
    );
}

// one file alone: the card under the bubble it has always been
function FileCard({ path, seen }: { path: string; seen: FileSeen }) {
    const opener = usePathOpener();
    const missing = seen.status === "missing";
    const name = mentionBaseName(path);
    const sub = [parentName(path), sizeOf(seen)].filter((s) => s !== "").join(" · ");
    return (
        <button
            type="button"
            data-chat-file-card={path}
            data-chat-file-missing={missing ? "" : undefined}
            title={path}
            onClick={(e) => {
                e.stopPropagation();
                opener?.open(path);
            }}
            className={cn(
                "flex h-[46px] w-[236px] items-center gap-2.5 rounded-[8px] border border-edge-mid bg-surface px-2.5 text-left hover:bg-surface-hover",
                opener != null ? "cursor-pointer" : "cursor-default",
                missing && "opacity-60"
            )}
        >
            <Tile name={name} className="h-[30px] w-[30px] rounded-[6px] bg-surface-hover text-[9.5px]" />
            <span className="flex min-w-0 flex-col items-start gap-px">
                <span className={cn("max-w-[168px] truncate text-[12.5px] text-ink-hi", missing && "line-through")}>
                    {name}
                </span>
                {missing ? (
                    <span className="max-w-[168px] truncate text-[11px] text-error">Not found</span>
                ) : sub !== "" ? (
                    <span className="max-w-[168px] truncate text-[11px] text-ink-faint">{sub}</span>
                ) : null}
            </span>
        </button>
    );
}

// the cards behind the front one: the first tilts right and sits lower, the second tilts left and peeks higher. A hover
// or keyboard focus on the pile fans them apart (not under reduced motion, where only the front card lightens)
const BACK_CLASS = [
    "right-[6px] w-[256px] rotate-[3deg] motion-safe:group-hover:translate-x-3 motion-safe:group-hover:-translate-y-2 motion-safe:group-hover:rotate-[6deg] motion-safe:group-focus-visible:translate-x-3 motion-safe:group-focus-visible:-translate-y-2 motion-safe:group-focus-visible:rotate-[6deg]",
    "right-[18px] top-0 w-[236px] rotate-[-2deg] motion-safe:group-hover:-translate-x-6 motion-safe:group-hover:-translate-y-3 motion-safe:group-hover:rotate-[-7deg] motion-safe:group-focus-visible:-translate-x-6 motion-safe:group-focus-visible:-translate-y-3 motion-safe:group-focus-visible:rotate-[-7deg]",
];

function FilePile({
    paths,
    seen,
    line,
    onOpen,
    focusRef,
}: {
    paths: string[];
    seen: FileSeen[];
    line: string;
    onOpen: (fromKeyboard: boolean) => void;
    focusRef: RefObject<HTMLButtonElement | null>;
}) {
    const backs = pileBacks(paths);
    const front = mentionBaseName(paths[0]);
    const frontMissing = seen[0]?.status === "missing";
    return (
        // the padding leaves room for the cards behind to fan inside the box that folds the pile away
        <div className="pb-1 pl-8 pr-3 pt-4">
            <button
                ref={focusRef}
                type="button"
                data-chat-file-pile={paths.length}
                title={`Show all ${paths.length} files`}
                aria-label={`Show all ${paths.length} files`}
                aria-expanded={false}
                onClick={(e) => {
                    e.stopPropagation();
                    onOpen(e.detail === 0);
                }}
                className={cn(
                    "group relative block w-[280px] cursor-pointer rounded-[12px] text-left outline-none",
                    backs.length === 2 ? "h-[90px]" : "h-[74px]"
                )}
            >
                {backs.map((path, i) => (
                    <span
                        key={`${i}:${path}`}
                        aria-hidden
                        data-chat-file-back={path}
                        className={cn(
                            "absolute flex h-[46px] origin-bottom items-start gap-2 rounded-[11px] border border-edge-mid bg-surface-raised px-2.5 pt-1.5 transition-[translate,rotate] duration-[140ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                            BACK_CLASS[i],
                            i === 0 && (backs.length === 2 ? "top-[16px]" : "top-0")
                        )}
                        style={{ zIndex: 2 - i }}
                    >
                        <Tile
                            name={mentionBaseName(path)}
                            className="h-[22px] w-[22px] rounded-[5px] bg-surface-hover text-[7.5px]"
                        />
                        <span className="min-w-0 truncate text-[12px] text-secondary">{mentionBaseName(path)}</span>
                    </span>
                ))}
                <span
                    data-chat-file-front={paths[0]}
                    className="absolute bottom-0 right-0 z-[3] flex h-[52px] w-[280px] items-center gap-2.5 rounded-[12px] border border-edge-mid bg-surface-hover pl-2.5 pr-3 shadow-popover-line transition-[background-color,border-color,translate] duration-[140ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:border-edge-strong group-hover:bg-surface-selected group-focus-visible:border-edge-strong group-focus-visible:bg-surface-selected group-focus-visible:ring-2 group-focus-visible:ring-accent group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background motion-safe:group-hover:-translate-y-px"
                >
                    <Tile name={front} className="h-[30px] w-[30px] rounded-[7px] bg-background text-[9px]" />
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <span className={cn("truncate text-[12.5px] text-primary", frontMissing && "line-through")}>
                            {front}
                        </span>
                        <span data-chat-file-line className="truncate text-[11px] text-ink-mid">
                            {line}
                        </span>
                    </span>
                </span>
            </button>
        </div>
    );
}

function FileList({
    paths,
    seen,
    folder,
    total,
    onCollapse,
    focusRef,
}: {
    paths: string[];
    seen: FileSeen[];
    folder: string | null;
    total: string | null;
    onCollapse: (fromKeyboard: boolean) => void;
    focusRef: RefObject<HTMLButtonElement | null>;
}) {
    const opener = usePathOpener();
    return (
        <div
            data-chat-file-list
            className="w-[400px] max-w-full overflow-hidden rounded-[12px] border border-edge-strong bg-surface-raised shadow-popover-line"
        >
            <div className="flex items-center gap-1.5 border-b border-edge-mid px-3 py-2 text-[11.5px] text-muted">
                <span className="text-secondary">{paths.length} files</span>
                {folder != null && folder !== "" ? (
                    <>
                        <span>·</span>
                        <span className="min-w-0 truncate">{folder}</span>
                    </>
                ) : null}
                {total != null ? (
                    <>
                        <span>·</span>
                        <span className="tabular-nums">{total}</span>
                    </>
                ) : null}
                <span className="flex-1" />
                <button
                    ref={focusRef}
                    type="button"
                    data-chat-file-collapse
                    aria-expanded
                    onClick={(e) => {
                        e.stopPropagation();
                        onCollapse(e.detail === 0);
                    }}
                    className="cursor-pointer rounded-sm text-muted outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    Collapse
                </button>
            </div>
            {paths.map((path, i) => {
                const s = seen[i];
                const missing = s?.status === "missing";
                const name = mentionBaseName(path);
                // a folder of its own only when the files do not share one (the header names a shared one)
                const sub = missing
                    ? "Not found"
                    : [folder == null ? parentName(path) : "", sizeOf(s)].filter((x) => x !== "").join(" · ");
                return (
                    <button
                        key={`${i}:${path}`}
                        type="button"
                        data-chat-file-card={path}
                        data-chat-file-missing={missing ? "" : undefined}
                        title={path}
                        onClick={(e) => {
                            e.stopPropagation();
                            opener?.open(path);
                        }}
                        className={cn(
                            "group flex w-full items-center gap-2.5 px-3 py-1.5 text-left outline-none hover:bg-surface-hover focus-visible:bg-surface-hover",
                            opener != null ? "cursor-pointer" : "cursor-default",
                            missing && "opacity-60"
                        )}
                    >
                        <Tile name={name} className="h-6 w-6 rounded-[5px] bg-surface-hover text-[8.5px]" />
                        <span
                            className={cn(
                                "min-w-0 flex-1 truncate text-[12.5px] text-ink-hi",
                                missing && "line-through"
                            )}
                        >
                            {name}
                        </span>
                        <span
                            className={cn("flex-none text-[11px] tabular-nums", missing ? "text-error" : "text-muted")}
                        >
                            {sub}
                        </span>
                        {/* the arrow keeps its room while hidden, so showing it never shifts the size column */}
                        <ArrowUpRight
                            aria-hidden
                            size={13}
                            strokeWidth={2}
                            className={cn(
                                "flex-none text-secondary opacity-0 transition-opacity duration-[140ms]",
                                opener != null && "group-hover:opacity-100 group-focus-visible:opacity-100"
                            )}
                        />
                    </button>
                );
            })}
        </div>
    );
}

export function ChatFileCards({ paths }: { paths: string[] }) {
    const seen = useFilesSeen(paths);
    const [open, setOpen] = useState(false);
    // a toggle made from the keyboard moves focus to the control that replaces the one pressed, so Enter twice folds back
    const refocus = useRef(false);
    const pileRef = useRef<HTMLButtonElement>(null);
    const collapseRef = useRef<HTMLButtonElement>(null);
    const part = usePartMotion(springReveal);
    useEffect(() => {
        if (refocus.current) {
            refocus.current = false;
            (open ? collapseRef : pileRef).current?.focus();
        }
    }, [open]);
    const shape = filesShape(paths.length);
    if (shape === "none") {
        return null;
    }
    if (shape === "card") {
        return (
            <div data-chat-file-cards className="flex justify-end">
                <FileCard path={paths[0]} seen={seen[0]} />
            </div>
        );
    }
    const folder = commonFolder(paths);
    const bytes = totalBytes(seen);
    const total = bytes != null ? fmtSize(bytes) : null;
    const toggle = (next: boolean) => (fromKeyboard: boolean) => {
        refocus.current = fromKeyboard;
        setOpen(next);
    };
    return (
        <div data-chat-file-cards className="flex flex-col items-end">
            <AnimatePresence initial={false}>
                {open ? (
                    <motion.div key="list" {...part} className="max-w-full overflow-hidden">
                        <FileList
                            paths={paths}
                            seen={seen}
                            folder={folder}
                            total={total}
                            onCollapse={toggle(false)}
                            focusRef={collapseRef}
                        />
                    </motion.div>
                ) : (
                    // the negative margin keeps the front card's right edge on the bubble's, past the room left for the fan
                    <motion.div key="pile" {...part} className="-mr-3 overflow-hidden">
                        <FilePile
                            paths={paths}
                            seen={seen}
                            line={pileLine(paths.length, folder, total)}
                            onOpen={toggle(true)}
                            focusRef={pileRef}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
