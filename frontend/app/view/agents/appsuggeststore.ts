// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Reads what appsuggest.ts needs from a pinned app's folder: package.json, the lockfiles, the files its scripts run, .env
// and vite.config. Read once when the folder is picked, never run, and never kept: the form holds the answer. Pin as
// app on a running server opens that same form, filled from the server.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { homeFromInfo } from "@/app/view/jarvis/projectpicker";
import { base64ToString } from "@/util/util";
import type { AgentsViewModel } from "./agents";
import {
    LOCKFILES,
    entriesToRead,
    formFromServer,
    suggestScripts,
    type ScriptSuggestion,
    type ServerSeen,
} from "./appsuggest";
import { selectedToolAtom, setupTabAtom, toolFormAtom, toolsSearchAtom } from "./setupstore";
import { emptyForm } from "./toolslibrarymodel";

// a file past this is not a config or a server's entry worth reading for a port
const MAX_READ = 512 * 1024;
const VITE_CONFIGS = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"];

// the home folder a ~ path names, asked of the server; "" when it cannot say
export async function homeDir(): Promise<string> {
    try {
        return homeFromInfo(await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: "~" } }));
    } catch {
        return "";
    }
}

function join(dir: string, rel: string): string {
    return `${dir.replace(/[\\/]+$/, "")}/${rel}`;
}

// a file's text; null when it is missing, a folder, too big or unreadable
async function readText(path: string): Promise<string | null> {
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

async function exists(path: string): Promise<boolean> {
    try {
        const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path } });
        return info != null && !info.notfound;
    } catch {
        return false;
    }
}

async function firstText(dir: string, names: string[]): Promise<string | null> {
    for (const name of names) {
        const text = await readText(join(dir, name));
        if (text != null) {
            return text;
        }
    }
    return null;
}

// Pin as app on a server seen running: Setup → Tools opens on the add form, filled from that server (its folder, its
// first port, and the folder's script that starts it, formFromServer). Nothing is saved until Add tool.
export async function pinServerAsApp(model: Pick<AgentsViewModel, "surfaceAtom">, seen: ServerSeen): Promise<void> {
    const scripts = await suggestForFolder(seen.cwd);
    globalStore.set(toolFormAtom, { ...emptyForm(), ...formFromServer(seen, scripts) });
    globalStore.set(selectedToolAtom, null);
    globalStore.set(toolsSearchAtom, "");
    globalStore.set(setupTabAtom, "tools");
    globalStore.set(model.surfaceAtom, "setup");
}

// The scripts of the folder, servers first; [] when it has no package.json. A leading ~ is the home folder.
export async function suggestForFolder(raw: string): Promise<ScriptSuggestion[]> {
    const typed = raw.trim();
    if (typed === "") {
        return [];
    }
    const dir = typed === "~" || /^~[\\/]/.test(typed) ? (await homeDir()) + typed.slice(1) : typed;
    const packageJson = await readText(join(dir, "package.json"));
    if (packageJson == null) {
        return [];
    }
    const [lockfiles, entries, env, viteConfig] = await Promise.all([
        Promise.all(LOCKFILES.map(async ([name]) => ((await exists(join(dir, name))) ? name : null))).then((l) =>
            l.filter((n): n is string => n != null)
        ),
        Promise.all(entriesToRead(packageJson).map(async (e) => [e, await readText(join(dir, e))] as const)).then(
            (pairs) => Object.fromEntries(pairs)
        ),
        readText(join(dir, ".env")),
        firstText(dir, VITE_CONFIGS),
    ]);
    return suggestScripts({ packageJson, lockfiles, entries, env, viteConfig });
}
