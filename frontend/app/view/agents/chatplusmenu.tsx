// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The `+` of the chat box (it replaces the plain attach button): a menu opening upward from it, as Claude Desktop's does.
// Add files or photos (the native file dialog; Ctrl+U does the same in the box), Add folder (puts `/add-dir ` in the
// box), Slash commands (puts `/` in the box, which opens the `/` menu), and MCP servers and Plugins, which send `/mcp`
// and `/plugin` (both draw a menu on Claude Code's own screen, so the chat flips to Terminal). The submenus with toggles
// that Claude Desktop has are not here: they need a write path into Claude Code's settings. What a row does is the
// caller's (chatcomposer.tsx); this draws the button and the menu, and owns their keys: while it is open the menu holds
// the keyboard (`data-owns-keys`, as the footer's chip menus do), ↑↓ move, Enter picks, and Escape or a press outside
// closes it and gives the focus back to the box.

import { PopoverReveal } from "@/app/element/popoverreveal";
import { cn } from "@/util/util";
import { Blocks, ChevronRight, Folder, Paperclip, Plug, Plus, SquareSlash, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

type PlusItem = "files" | "folder" | "slash" | "mcp" | "plugins";

const ITEMS: { id: PlusItem; label: string; icon: LucideIcon; hint: string; more?: boolean }[] = [
    { id: "files", label: "Add files or photos", icon: Paperclip, hint: "Ctrl+U" },
    { id: "folder", label: "Add folder", icon: Folder, hint: "/add-dir" },
    { id: "slash", label: "Slash commands", icon: SquareSlash, hint: "/" },
    { id: "mcp", label: "MCP servers", icon: Blocks, hint: "", more: true },
    { id: "plugins", label: "Plugins", icon: Plug, hint: "", more: true },
];

export function ChatPlusMenu({
    onAttach,
    onText,
    onSend,
    onFocusBox,
    disabled = false,
}: {
    /** Add files or photos */
    onAttach: () => void;
    /** puts text in the box (`/add-dir `, `/`) and focuses it, the caret after it */
    onText: (text: string) => void;
    /** sends a message as if typed (`/mcp`, `/plugin`) */
    onSend: (text: string) => void;
    /** gives the focus back to the box, once the menu closes without a pick */
    onFocusBox: () => void;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [at, setAt] = useState(0);
    const root = useRef<HTMLDivElement>(null);
    const rows = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    // the keyboard lands on the highlighted row, so ↑↓ and Enter work at once (a layout effect: with the commit, not a
    // frame later, so a key that follows quickly finds the focus where the highlight is)
    useLayoutEffect(() => {
        if (open) {
            rows()[at]?.focus();
        }
    }, [open, at]);
    useEffect(() => {
        if (!open) {
            return;
        }
        const onDown = (e: PointerEvent) => {
            if (root.current?.contains(e.target as Node)) {
                return;
            }
            setOpen(false);
            // the press lands focus on what it hit; when it hit nothing that takes focus, the box gets it back
            requestAnimationFrame(() => {
                if (document.activeElement == null || document.activeElement === document.body) {
                    onFocusBox();
                }
            });
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
    }, [open, onFocusBox]);
    const toggle = () => {
        if (open) {
            setOpen(false);
            onFocusBox();
        } else {
            setAt(0);
            setOpen(true);
        }
    };
    const pick = (id: PlusItem) => {
        setOpen(false);
        // the action takes the focus itself (the file dialog, the box, the terminal)
        if (id === "files") {
            onAttach();
        } else if (id === "folder") {
            onText("/add-dir ");
        } else if (id === "slash") {
            onText("/");
        } else if (id === "mcp") {
            onSend("/mcp");
        } else {
            onSend("/plugin");
        }
    };
    const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
        if (!open) {
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            onFocusBox();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            setAt((at + (e.key === "ArrowDown" ? 1 : ITEMS.length - 1)) % ITEMS.length);
        } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // the highlighted row, not whatever the focus is on (the browser's own Enter-clicks-the-button would pick the
            // focused one, and a click on the row already picks it)
            e.preventDefault();
            e.stopPropagation();
            pick(ITEMS[at].id);
        }
    };
    return (
        // data-owns-keys while open: Escape closes the menu and nothing else (the Agent surface's own Escape would leave
        // for the Cockpit; see ChipMenu in chatfooter.tsx)
        <div
            ref={root}
            data-owns-keys={open ? "" : undefined}
            onKeyDown={onKeyDown}
            onBlur={(e) => {
                // Tab out of the menu closes it; a move between the button and its rows does not
                if (open && e.relatedTarget != null && !root.current?.contains(e.relatedTarget as Node)) {
                    setOpen(false);
                }
            }}
            className="relative flex-none"
        >
            <button
                type="button"
                data-chat-plus
                data-chat-attach
                aria-label="Add files, a folder or a command"
                aria-haspopup="menu"
                aria-expanded={open}
                title="Add files, a folder or a command"
                disabled={disabled}
                onClick={toggle}
                className={cn(
                    "flex h-[28px] w-[28px] flex-none cursor-pointer items-center justify-center rounded-[8px] text-ink-mid hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
                    open && "bg-surface-hover"
                )}
            >
                <Plus size={16} strokeWidth={1.8} aria-hidden />
            </button>
            <PopoverReveal
                open={open}
                origin="bottom left"
                className="absolute bottom-[calc(100%+8px)] left-0 z-10 w-[260px] rounded-[12px] border border-edge-mid bg-surface-raised p-1.5 shadow-popover"
            >
                <div role="menu" aria-label="Add" data-chat-plus-menu>
                    {ITEMS.map((item, i) => (
                        <button
                            key={item.id}
                            type="button"
                            role="menuitem"
                            tabIndex={-1}
                            data-chat-plus-item={item.id}
                            onMouseEnter={() => setAt(i)}
                            onClick={() => pick(item.id)}
                            className={cn(
                                "flex w-full cursor-pointer items-center gap-2.5 rounded-[6px] px-2 py-[7px] text-[13px] text-ink-hi focus-visible:outline-none",
                                i === at && "bg-surface-hover"
                            )}
                        >
                            <span className="flex w-[18px] flex-none justify-center text-ink-mid">
                                <item.icon size={15} strokeWidth={1.8} aria-hidden />
                            </span>
                            <span className="flex-1 text-left">{item.label}</span>
                            {item.hint ? (
                                <span className="font-mono text-[11.5px] text-ink-faint">{item.hint}</span>
                            ) : null}
                            {item.more ? (
                                <ChevronRight size={12} strokeWidth={2} aria-hidden className="flex-none text-muted" />
                            ) : null}
                        </button>
                    ))}
                </div>
            </PopoverReveal>
        </div>
    );
}
