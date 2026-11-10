// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Skim highlights in Chat, the state half (chatskim.ts is the pure half). Two module-level atoms, as every surface but
// Agent unmounts on a switch: the marks the skim mod keeps, read from its plugin store file with the file commands the
// other stores here use (no wshrpc command of its own), and Chat's own highlight toggle, global and remembered in
// localStorage `chat.skim` (on unless it says false). The toggle does not type /skim into the agent: that is the
// terminal's fold and dim, per session, and a command typed from a display toggle would add a row to the conversation.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { base64ToString, makeConnRoute } from "@/util/util";
import { atom, useAtomValue } from "jotai";
import { hashText, marksByHash, parseSkimOn, sameMarks, skimStoreFiles } from "./chatskim";
import { homeDir } from "./pathlinkroute";

const STORAGE_KEY = "chat.skim";
// the file commands are cheap, but a long reply lands as a burst of transcript appends: at most one read a second
const THROTTLE_MS = 1000;
const NO_MARKS: string[] = [];

function readOn(): boolean {
    try {
        return parseSkimOn(localStorage.getItem(STORAGE_KEY));
    } catch {
        return true;
    }
}

const onAtom = atom<boolean>(readOn());

// whether Chat draws skim highlights; writing it keeps it in localStorage
export const chatSkimOnAtom = atom(
    (get) => get(onAtom),
    (_get, set, next: boolean) => {
        set(onAtom, next);
        try {
            localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
        } catch {
            // storage unavailable: the toggle holds for this session
        }
    }
);

// the marks of every reply the skim mod kept, by the hash of the reply's stored text
const marksAtom = atom<Map<string, string[]>>(new Map());

// the sentences to highlight in a prose part of Chat: its stored marks while the toggle is on, else none
export function useSkimMarks(text: string): string[] {
    const on = useAtomValue(chatSkimOnAtom);
    const all = useAtomValue(marksAtom);
    return on ? (all.get(hashText(text)) ?? NO_MARKS) : NO_MARKS;
}

// a read that failed warns once per distinct message, so a machine with no skim mod does not log on every append
const warned = new Set<string>();
function warnOnce(e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    if (!warned.has(message)) {
        warned.add(message);
        console.warn("[chat] skim marks not read:", message);
    }
}

async function storeDir(): Promise<string> {
    // DEV only: the scenarios read a folder of their own, as the person's real home is not theirs to touch
    const dev = import.meta.env.DEV && typeof window !== "undefined" ? window.__chatSkimStoreDir : undefined;
    if (typeof dev === "string" && dev !== "") {
        return dev.replace(/[\\/]+$/, "");
    }
    const home = await homeDir();
    if (home === "") {
        throw new Error("the home folder is unknown");
    }
    return `${home.replace(/[\\/]+$/, "")}/.claude/plugins/store`;
}

async function readStoreTexts(): Promise<string[]> {
    const dir = await storeDir();
    const listed: { name: string; size: number; isdir?: boolean }[] = [];
    const gen = RpcApi.RemoteListEntriesCommand(TabRpcClient, { path: dir }, { route: makeConnRoute(null) });
    for await (const chunk of gen) {
        for (const f of chunk.fileinfo ?? []) {
            listed.push({ name: f.name ?? "", size: f.size ?? 0, isdir: f.isdir });
        }
    }
    return Promise.all(
        skimStoreFiles(listed).map(async (name) => {
            const data = await RpcApi.FileReadCommand(TabRpcClient, { info: { path: `${dir}/${name}` } });
            return data?.data64 != null ? base64ToString(data.data64) : "";
        })
    );
}

// the newest read wins: a slow one that started earlier never overwrites it
let readSeq = 0;

async function readMarks(): Promise<void> {
    const seq = ++readSeq;
    try {
        const next = marksByHash(await readStoreTexts());
        // an unchanged store sets nothing, so no prose part re-renders for it
        if (seq === readSeq && !sameMarks(globalStore.get(marksAtom), next)) {
            globalStore.set(marksAtom, next);
        }
    } catch (e) {
        warnOnce(e);
    }
}

let lastRun = 0;
let trailing: ReturnType<typeof setTimeout> | null = null;

// Reads the skim store again, at most once a second, leading and trailing: a call inside the window is not dropped, it
// runs once as the window ends (several calls in one window are that one run). Called when Chat mounts and each time its
// transcript grows: the mod writes the store before the transcript line, so the newest reply's marks are there by then.
export function refreshSkimMarks(): void {
    if (trailing != null) {
        return;
    }
    const wait = lastRun + THROTTLE_MS - Date.now();
    if (wait <= 0) {
        lastRun = Date.now();
        void readMarks();
        return;
    }
    trailing = setTimeout(() => {
        trailing = null;
        lastRun = Date.now();
        void readMarks();
    }, wait);
}

declare global {
    interface Window {
        // DEV only, for the agent-chat scenario: the folder read in place of ~/.claude/plugins/store (forward slashes)
        __chatSkimStoreDir?: string;
    }
}
