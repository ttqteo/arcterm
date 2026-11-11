// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The `/` menu of the chat box: a `/` typed as the box's first character lists Claude Code's commands above the box,
// grouped (Built-in, Skills, Plugins, MCP) in a list that scrolls, and a pick puts `/<name> ` in the text
// (slashcommands.ts holds the pure rules). The commands are the ones Claude Code's own typeahead offers in that session,
// which the arc mod publishes to wavesrv per agent (`GetClaudeLiveCommandsCommand`); the list is asked for again each
// time the menu opens, so a skill or an MCP server added mid-session shows on the next `/`. With no such list (an agent
// started before the mod published, a sleeping one, wavesrv just restarted) the menu falls back to the copied built-ins
// plus what wavesrv reads off disk (`ListClaudeCommandsCommand`), and its footer says which list it is showing.
//
// `look: "frosted"` (only the chat box passes it) draws the list as Chat's suggestion panel (pickerlist.tsx), whose key
// line replaces the footer's key hints, so the footer keeps just the count; the launcher keeps the plain list.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import type { EditorLike, KeyLike } from "./chateditor";
import { PickerList, type PickerGroup, type PickerLook } from "./pickerlist";
import {
    BUILTIN_COMMANDS,
    fromLive,
    insertSlash,
    mergeCommands,
    slashGroups,
    slashMatches,
    slashQueryAt,
    type SlashCommand,
} from "./slashcommands";

export interface SlashMenuState {
    // the dropdown under the box, portaled out of its container (it draws nothing while no list shows)
    list: ReactNode;
    // every command the menu knows: the live list of the session, or the fallback's built-ins plus the fetched ones
    commands: SlashCommand[];
    // the list is on screen (a `/` word with at least one match)
    shown: boolean;
    onKeyDown: (e: KeyLike) => void;
    onCaret: (el: EditorLike) => void;
}

// The list may name a command twice (a skill and a plugin command of one name); the rows are keyed by name and a pick
// inserts the name, so the second would be a row indistinguishable from the first
function firstOfEachName(list: SlashCommand[]): SlashCommand[] {
    const seen = new Set<string>();
    return list.filter((c) => !seen.has(c.name) && !!seen.add(c.name));
}

/** The commands of the agent's session: the live list the arc mod published, else the copied built-ins plus what
 *  wavesrv reads off disk under `cwd`. `live` says which. Also read by Chat's /skills and /help cards. */
export async function fetchSlashCommands(
    blockId: string | undefined,
    cwd: string
): Promise<{ commands: SlashCommand[]; live: boolean }> {
    const live =
        blockId != null
            ? await RpcApi.GetClaudeLiveCommandsCommand(TabRpcClient, { blockid: blockId }).catch(() => null)
            : null;
    if (live != null && live.length > 0) {
        return { commands: firstOfEachName(fromLive(live)), live: true };
    }
    const found = await RpcApi.ListClaudeCommandsCommand(TabRpcClient, { cwd }).catch(() => null);
    return { commands: mergeCommands(BUILTIN_COMMANDS, found ?? []), live: false };
}

// A query no command matches shows nothing, so a `/` meant as text never blocks Enter; a query that already names the
// highlighted command lets Enter send it (Tab completes). `cwd` is where the agent works (project-level skills and
// commands are read from there on the fallback), "" when unknown; `blockId` is the agent's terminal block, the key of its
// live list. `off` keeps the menu closed (a recalled message sits in the box). `setText` takes the caret a pick puts
// the text's caret at, for a box that draws the text again (the chat editor places it as it does). `look` and `frame` are
// the frosted panel and the element it stands over (the message box).
export function useSlashMenu({
    text,
    setText,
    cwd,
    blockId,
    inputRef,
    off = false,
    look,
    frame,
}: {
    text: string;
    setText: (text: string, caret?: number) => void;
    cwd: string;
    blockId?: string;
    inputRef: RefObject<EditorLike | null>;
    off?: boolean;
    look?: PickerLook;
    frame?: RefObject<HTMLElement | null>;
}): SlashMenuState {
    const [caret, setCaret] = useState(0);
    const [pick, setPick] = useState(0);
    // Escape closed the list; it stays closed until the caret leaves the command word
    const [dismissed, setDismissed] = useState(false);
    // the last list asked for, kept between opens so the menu shows at once; `live` says it is the session's own
    const [known, setKnown] = useState<{ commands: SlashCommand[]; live: boolean }>({
        commands: BUILTIN_COMMANDS,
        live: false,
    });
    const query = off ? null : slashQueryAt(text, caret);
    const open = query != null && !dismissed;
    useEffect(() => {
        if (!open) {
            return;
        }
        let stale = false;
        fetchSlashCommands(blockId, cwd).then((got) => {
            if (!stale) {
                setKnown(got);
            }
        });
        return () => {
            stale = true;
        };
    }, [open, cwd, blockId]);
    const grouped = open ? slashGroups(slashMatches(query, known.commands)) : [];
    const matches = grouped.flatMap((g) => g.items);
    const groups: PickerGroup[] = [];
    let start = 0;
    for (const g of grouped) {
        groups.push({ title: g.title, count: g.items.length, start });
        start += g.items.length;
    }
    const shown = matches.length > 0;
    const at = Math.min(pick, Math.max(matches.length - 1, 0));

    const choose = (c: SlashCommand) => {
        const next = insertSlash(text, caret, c.name);
        setText(next.text, next.caret);
        setCaret(next.caret);
        setPick(0);
        requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(next.caret, next.caret);
        });
    };
    // the menu's keys stop here: the box's own handler would send on Enter
    const onKeyDown = (e: KeyLike) => {
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
    // a keystroke or a click that moves the caret starts the list from its best match again; ↑↓ do not, and neither does a
    // select event that finds the caret where it was (the first key after the box is focused raises one, which would send
    // a first ↓ back to the top once its key is up)
    const onCaret = (el: EditorLike) => {
        if (el.selectionStart !== caret) {
            setCaret(el.selectionStart);
            setPick(0);
        }
        if (slashQueryAt(el.value, el.selectionStart) == null) {
            setDismissed(false);
        }
    };

    const total = known.commands.length;
    const count = (
        <span>
            {total} {total === 1 ? "command" : "commands"} {known.live ? "in this session" : "found on disk"}
        </span>
    );
    const list = (
        <PickerList
            anchor={inputRef}
            look={look}
            frame={frame}
            shown={shown}
            note={null}
            items={matches}
            at={at}
            onPick={choose}
            onHover={setPick}
            label="Commands"
            listAttr="data-chat-slash"
            listAttrs={{ "data-chat-slash-live": String(known.live) }}
            itemAttr="data-chat-slash-item"
            itemKey={(c) => c.name}
            itemTitle={(c) => c.description ?? c.name}
            groups={groups}
            footer={
                look === "frosted" ? (
                    <div className="flex shrink-0 justify-end border-t border-edge-faint px-4 py-[7px] text-[11.5px] text-ink-faint">
                        {count}
                    </div>
                ) : (
                    <div className="flex shrink-0 gap-3.5 border-t border-edge-faint px-3.5 py-[7px] text-[11.5px] text-ink-faint">
                        <span>
                            <span className="font-mono text-muted">↑↓</span> move
                        </span>
                        <span>
                            <span className="font-mono text-muted">Tab</span> complete
                        </span>
                        <span>
                            <span className="font-mono text-muted">Enter</span> run
                        </span>
                        <span className="flex-1" />
                        {count}
                    </div>
                )
            }
            renderItem={(c) => (
                <>
                    <span className="w-[210px] shrink-0 truncate text-[13px] text-ink-hi">/{c.name}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{c.description}</span>
                    {c.plugin ? (
                        <span className="shrink-0 rounded-[6px] border border-edge-mid px-1.5 text-[11px] text-muted">
                            {c.plugin}
                        </span>
                    ) : null}
                    {c.tui ? (
                        <span
                            title="Opens a menu on Claude Code's own screen"
                            className="shrink-0 text-[11px] text-ink-faint"
                        >
                            opens in Terminal
                        </span>
                    ) : null}
                </>
            )}
        />
    );
    return { list, commands: known.commands, shown, onKeyDown, onCaret };
}
