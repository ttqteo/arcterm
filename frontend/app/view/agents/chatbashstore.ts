// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Per folder, session-only (nothing is persisted): the `!` commands Claude Code's own history holds for the folder,
// newest first, which Chat's bash mode takes its ghost text from. The folder's list is read once, the first time its
// box is in bash mode (`BashHistoryCommand`), and a command run from the box moves to the front as Claude Code moves it.
// The rules are chatbash.ts's.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, useAtomValue } from "jotai";
import { useEffect } from "react";
import { ranFirst } from "./chatbash";

/** How many distinct commands Claude Code looks through for its ghost text, and so how many are kept. */
const BASH_HISTORY_MAX = 50;

const NONE: string[] = [];

// folder (as the agent's block names it) -> its `!` commands, newest first
const historyAtom = atom<ReadonlyMap<string, string[]>>(new Map());

// the folders whose list was asked for: a folder is read once, however many boxes show it
const requested = new Set<string>();

function setFolder(cwd: string, list: string[]): void {
    const m = new Map(globalStore.get(historyAtom));
    m.set(cwd, list);
    globalStore.set(historyAtom, m);
}

/** Reads the folder's list, unless it was asked for already. A command noted while the read was out stays in front of
 *  what it brings. */
function load(cwd: string): void {
    if (requested.has(cwd)) {
        return;
    }
    requested.add(cwd);
    RpcApi.BashHistoryCommand(TabRpcClient, { cwd }).then(
        (read) => {
            const noted = globalStore.get(historyAtom).get(cwd) ?? NONE;
            const rest = (read ?? NONE).filter((h) => !noted.includes(h));
            setFolder(cwd, [...noted, ...rest].slice(0, BASH_HISTORY_MAX));
        },
        (err) => {
            // no history (no Claude Code folder, a read that failed) is no ghost text, not an error to show; the next
            // time the box enters bash mode asks again
            console.warn("chat bash: reading the history failed", err);
            requested.delete(cwd);
        }
    );
}

/** The folder's `!` commands, newest first (empty until read, and with no folder). `on` is whether the box is in bash
 *  mode: the read starts the first time it is, so a folder whose box never sees a `!` costs nothing. */
export function useBashHistory(cwd: string | undefined, on: boolean): string[] {
    const all = useAtomValue(historyAtom);
    useEffect(() => {
        if (on && cwd) {
            load(cwd);
        }
    }, [cwd, on]);
    return (cwd ? all.get(cwd) : undefined) ?? NONE;
}

/** A command run from the box (the text after its `!`): it goes to the front of the folder's list. */
export function noteBashRun(cwd: string | undefined, cmd: string): void {
    if (!cwd || cmd === "") {
        return;
    }
    setFolder(cwd, ranFirst(globalStore.get(historyAtom).get(cwd) ?? NONE, cmd).slice(0, BASH_HISTORY_MAX));
}
