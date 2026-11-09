// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The `/` menu of the chat box: a `/` typed as the box's first character lists Claude Code's commands under the box, and
// a pick puts `/<name> ` in the text (slashcommands.ts holds the pure rules). The built-ins show at once; the skills and
// plugin commands come from wavesrv (`ListClaudeCommandsCommand`) on the first `/` after each mount of the box.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { PickerList } from "./pickerlist";
import {
    BUILTIN_COMMANDS,
    insertSlash,
    mergeCommands,
    slashMatches,
    slashQueryAt,
    type SlashCommand,
} from "./slashcommands";

export interface SlashMenuState {
    // the dropdown under the box, portaled out of its container (it draws nothing while no list shows)
    list: ReactNode;
    // every command the menu knows: the built-ins, plus the fetched ones once they are in
    commands: SlashCommand[];
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
    onCaret: (el: HTMLTextAreaElement) => void;
}

// A query no command matches shows nothing, so a `/` meant as text never blocks Enter; a query that already names the
// highlighted command lets Enter send it (Tab completes). `cwd` is where the agent works (project-level skills and
// commands are read from there), "" when unknown. `off` keeps the menu closed (a recalled message sits in the box).
export function useSlashMenu({
    text,
    setText,
    cwd,
    inputRef,
    off = false,
}: {
    text: string;
    setText: (text: string) => void;
    cwd: string;
    inputRef: RefObject<HTMLTextAreaElement | null>;
    off?: boolean;
}): SlashMenuState {
    const [caret, setCaret] = useState(0);
    const [pick, setPick] = useState(0);
    // Escape closed the list; it stays closed until the caret leaves the command word
    const [dismissed, setDismissed] = useState(false);
    const [fetched, setFetched] = useState<SlashCommand[]>(BUILTIN_COMMANDS);
    const requested = useRef(false);
    const query = off ? null : slashQueryAt(text, caret);
    const open = query != null && !dismissed;
    useEffect(() => {
        if (!open || requested.current) {
            return;
        }
        requested.current = true;
        RpcApi.ListClaudeCommandsCommand(TabRpcClient, { cwd }).then(
            (found) => setFetched(mergeCommands(BUILTIN_COMMANDS, found ?? [])),
            () => {
                // the built-ins stay
            }
        );
    }, [open, cwd]);
    const matches = open ? slashMatches(query, fetched) : [];
    const shown = matches.length > 0;
    const at = Math.min(pick, Math.max(matches.length - 1, 0));

    const choose = (c: SlashCommand) => {
        const next = insertSlash(text, caret, c.name);
        setText(next.text);
        setCaret(next.caret);
        setPick(0);
        requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(next.caret, next.caret);
        });
    };
    // the menu's keys stop here: the box's own handler would send on Enter
    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (!shown || e.nativeEvent.isComposing) {
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDismissed(true);
            return;
        }
        if (e.metaKey || e.ctrlKey || e.altKey) {
            return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            const n = matches.length;
            setPick((at + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
            // Enter on a command already typed in full is a send
            if (e.key === "Enter" && matches[at].name === query) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            choose(matches[at]);
        }
    };
    // a keystroke or a click moves the caret and starts the list from its best match again; ↑↓ do not
    const onCaret = (el: HTMLTextAreaElement) => {
        setCaret(el.selectionStart);
        setPick(0);
        if (slashQueryAt(el.value, el.selectionStart) == null) {
            setDismissed(false);
        }
    };

    const list = (
        <PickerList
            anchor={inputRef}
            shown={shown}
            note={null}
            items={matches}
            at={at}
            onPick={choose}
            onHover={setPick}
            label="Commands"
            listAttr="data-chat-slash"
            itemAttr="data-chat-slash-item"
            itemKey={(c) => c.name}
            itemTitle={(c) => c.description ?? c.name}
            renderItem={(c) => (
                <>
                    <span className="shrink-0 text-[12px] text-primary">/{c.name}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{c.description}</span>
                    {c.tui ? <span className="shrink-0 text-[10.5px] text-muted">opens in Terminal</span> : null}
                </>
            )}
        />
    );
    return { list, commands: fetched, onKeyDown, onCaret };
}
