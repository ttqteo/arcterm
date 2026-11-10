// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The files you sent with a chat message, as cards under your bubble (the chat-file-mentions canvas, "Sent"): a tile with
// the file's extension, its name, and the folder it sits in with its size. A card opens the file beside the agent as a path
// link does (pathlinkcontext.tsx); with no agent around it is only drawn. The size comes from one FileInfoCommand when the
// card mounts, and a file that is gone draws struck through with "Not found". Past CARD_LIMIT cards a "+N more" chip
// unfolds the rest in place.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { useEffect, useState } from "react";
import { fmtSize } from "./attachmenttray";
import { fileTag, foldCards, type FileTone } from "./chatfiles";
import { mentionBaseName } from "./filementiontokens";
import { usePathOpener } from "./pathlinkcontext";

const TONE_CLASS: Record<FileTone, string> = {
    pdf: "text-error",
    code: "text-accent-soft",
    data: "text-accent-soft",
    doc: "text-muted",
    other: "text-muted",
};

// what FileInfoCommand said of a card's file: still asking, its size, or that it is not there (not found, or the ask failed)
type Seen = { status: "loading" } | { status: "found"; size?: number } | { status: "missing" };

function useFileSeen(path: string): Seen {
    const [seen, setSeen] = useState<Seen>({ status: "loading" });
    useEffect(() => {
        let alive = true;
        setSeen({ status: "loading" });
        RpcApi.FileInfoCommand(TabRpcClient, { info: { path } })
            .then((info) => {
                if (alive) {
                    setSeen(
                        info == null || info.notfound
                            ? { status: "missing" }
                            : { status: "found", size: info.isdir ? undefined : info.size }
                    );
                }
            })
            .catch(() => {
                if (alive) {
                    setSeen({ status: "missing" });
                }
            });
        return () => {
            alive = false;
        };
    }, [path]);
    return seen;
}

// the name of the folder a path sits in ("" for a file at the root)
function parentName(path: string): string {
    const parts = path.split(/[\\/]/).filter((p) => p !== "");
    return parts.length >= 2 ? parts[parts.length - 2] : "";
}

function FileCard({ path }: { path: string }) {
    const opener = usePathOpener();
    const seen = useFileSeen(path);
    const missing = seen.status === "missing";
    const name = mentionBaseName(path);
    const { tag, tone } = fileTag(name);
    const size = seen.status === "found" && seen.size != null ? fmtSize(seen.size) : "";
    const sub = [parentName(path), size].filter((s) => s !== "").join(" · ");
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
            <span
                aria-hidden
                className={cn(
                    "flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[6px] bg-surface-hover font-mono text-[9.5px] font-semibold",
                    TONE_CLASS[tone]
                )}
            >
                {tag}
            </span>
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

export function ChatFileCards({ paths }: { paths: string[] }) {
    const [open, setOpen] = useState(false);
    const { shown, more } = foldCards(paths, open);
    return (
        <div data-chat-file-cards className="flex flex-wrap justify-end gap-2">
            {shown.map((path, i) => (
                <FileCard key={`${i}:${path}`} path={path} />
            ))}
            {more > 0 ? (
                <button
                    type="button"
                    data-chat-file-more
                    onClick={() => setOpen(true)}
                    className="h-[22px] cursor-pointer self-center rounded-[6px] border border-edge-mid px-2 text-[12px] text-muted hover:text-secondary"
                >
                    +{more} more
                </button>
            ) : null}
        </div>
    );
}
