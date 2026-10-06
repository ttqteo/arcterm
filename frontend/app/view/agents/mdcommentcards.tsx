// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cards and the comment box that hang off a block of the File tab's markdown Preview
// (docs/superpowers/specs/2026-10-06-md-comments-design.md). Markdown renders a CardSlot after every stamped block (as
// an li's last child); the slot finds the block it follows and shows what MdDoc hosts there, through MdDocContext, so
// a card change never re-renders the document.

import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { Pencil, X } from "lucide-react";
import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import { commentRefLabel, type MdComment, type QuoteKind } from "./mdcomments";
import { addComment, cancelBox, deleteComment, editComment, setBoxText, type MdBox } from "./mdcommentstore";

export interface MdDocCtx {
    agentId: string;
    hosts: Map<Element, MdComment[]>; // block element → the comments whose cards hang after it, in order
    box: MdBox | undefined; // the open box, when it belongs to this file
    boxHost: Element | null;
    numbers: Map<string, number>; // comment id → its number in the message
    focusBox: () => void; // a box that holds text was kept: put the caret in it
    done: () => void; // a box closed: focus goes back to the document
}

export const MdDocContext = createContext<MdDocCtx | null>(null);

const META = "text-[10.5px] text-muted";
const CHIP =
    "inline-flex h-[17px] w-[17px] flex-none items-center justify-center rounded-full bg-accent text-[10.5px] font-bold leading-none text-background";
const ICON_BTN = "flex cursor-pointer border-0 bg-transparent p-[2px] text-muted hover:text-primary";
const ACCENT_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] border-0 bg-accent px-3.5 py-[7px] text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";
const SECONDARY_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] border border-edge-mid bg-surface-raised px-3 py-[6px] text-[12.5px] font-semibold text-secondary hover:border-edge-strong hover:bg-surface-hover";
const KBD = "rounded-[4px] bg-background/20 px-[5px] font-mono text-[10.5px]";

function Quote({ kind, lines }: { kind: QuoteKind; lines: string[] }) {
    if (kind === "none" || lines.length === 0) {
        return null;
    }
    if (kind === "selection") {
        return <div className="text-[11px] leading-[1.45] text-muted">“{lines[0]}”</div>;
    }
    return (
        <div className="flex min-w-0 flex-col font-mono text-[11px] leading-[1.45] text-muted">
            {lines.map((l, i) => (
                <span key={i} className="truncate whitespace-pre">
                    {l}
                </span>
            ))}
        </div>
    );
}

function MdCommentCard({ comment, n, ctx }: { comment: MdComment; n: number; ctx: MdDocCtx }) {
    return (
        <div
            data-md-card={comment.id}
            className="flex flex-col gap-[6px] rounded-[8px] border border-edge-mid bg-surface-raised px-3 py-[10px] leading-[1.5]"
        >
            <div className="flex items-center gap-2">
                <span className={CHIP}>{n}</span>
                <span className={cn(META, "min-w-0 flex-1 truncate")}>{commentRefLabel(comment)}</span>
                <button
                    type="button"
                    aria-label={`Edit comment ${n}`}
                    onClick={() => {
                        if (editComment(ctx.agentId, comment.id) === "kept") {
                            ctx.focusBox();
                        }
                    }}
                    className={ICON_BTN}
                >
                    <Pencil size={13} strokeWidth={2} aria-hidden />
                </button>
                <button
                    type="button"
                    aria-label={`Delete comment ${n}`}
                    onClick={() => deleteComment(ctx.agentId, comment.id)}
                    className={ICON_BTN}
                >
                    <X size={13} strokeWidth={2} aria-hidden />
                </button>
            </div>
            <Quote kind={comment.quoteKind} lines={comment.quote} />
            <div className="whitespace-pre-wrap text-[13px] text-primary">{comment.note}</div>
        </div>
    );
}

function MdCommentBox({ box, ctx }: { box: MdBox; ctx: MdDocCtx }) {
    const blank = box.text.trim() === "";
    const add = () => {
        if (addComment(ctx.agentId) != null) {
            ctx.done();
        }
    };
    const cancel = () => {
        cancelBox(ctx.agentId);
        ctx.done();
    };
    return (
        <div
            data-md-box
            className="flex flex-col gap-2 rounded-[8px] border border-accent bg-surface-raised px-3 py-[10px] leading-[1.5]"
        >
            <span className={META}>{commentRefLabel(box)}</span>
            <Quote kind={box.quoteKind} lines={box.quote} />
            <textarea
                rows={3}
                autoFocus
                value={box.text}
                placeholder="Leave a comment"
                aria-label="Your comment"
                onChange={(e) => setBoxText(ctx.agentId, e.target.value)}
                // the box owns its keys: Esc must not reach the File tab, which closes the file on it
                onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        e.stopPropagation();
                        add();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        cancel();
                    }
                }}
                className="resize-none rounded-[7px] border border-edge-mid bg-background px-[9px] py-[7px] text-[13px] leading-[1.5] text-primary outline-none placeholder:text-muted focus:border-accent"
            />
            <div className="flex justify-end gap-2">
                <button type="button" title="Cancel (Esc)" onClick={cancel} className={SECONDARY_BTN}>
                    Cancel
                </button>
                <button type="button" disabled={blank} onClick={add} className={ACCENT_BTN}>
                    Add comment
                    <span className={KBD}>{formatChordString("Ctrl:Enter")}</span>
                </button>
            </div>
        </div>
    );
}

// After a stamped block: the cards MdDoc hosts on that block, and the open box when it hangs there. The block is the
// slot's parent for a list item (the slot is the item's last child), else the element before it; read after every
// render, because an image appears only once its src resolves.
export function CardSlot({ inside }: { inside: boolean }) {
    const ctx = useContext(MdDocContext);
    const ref = useRef<HTMLDivElement>(null);
    const [block, setBlock] = useState<Element | null>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        const next = el == null ? null : inside ? el.parentElement : el.previousElementSibling;
        setBlock((prev) => (prev === next ? prev : next));
    });
    const comments = ctx != null && block != null ? (ctx.hosts.get(block) ?? []) : [];
    const box = ctx?.box != null && block != null && ctx.boxHost === block ? ctx.box : undefined;
    const shown = ctx != null && (comments.length > 0 || box != null);
    return (
        <div ref={ref} data-md-slot className={shown ? "my-2.5 flex flex-col gap-2.5" : "hidden"}>
            {shown
                ? comments.map((c) =>
                      box?.editingId === c.id ? (
                          <MdCommentBox key={c.id} box={box} ctx={ctx} />
                      ) : (
                          <MdCommentCard key={c.id} comment={c} n={ctx.numbers.get(c.id) ?? 0} ctx={ctx} />
                      )
                  )
                : null}
            {shown && box != null && box.editingId == null ? <MdCommentBox box={box} ctx={ctx} /> : null}
        </div>
    );
}
