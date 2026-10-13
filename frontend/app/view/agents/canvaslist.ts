// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The canvases a project holds: the folders under its .superpowers/design. Which agent has which canvas open lives
// only in memory (canvasstore.ts), so after a restart this listing is the way back to them; the palette reads it per
// open, as an agent makes a canvas while the palette is closed.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { makeConnRoute } from "@/util/util";
import { isCanvasSegment } from "../jarvis/address";
import { canvasDesignDir } from "./canvasmodel";

export type DesignEntry = { name?: string; isdir?: boolean };

// a name a canvas address can carry, so every topic listed opens
export function canvasTopics(entries: DesignEntry[]): string[] {
    return entries
        .filter((e) => e.isdir && e.name && isCanvasSegment(e.name))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
}

// a project with no design folder has no canvases, which is not an error
export async function listCanvasTopics(cwd: string): Promise<string[]> {
    const entries: DesignEntry[] = [];
    try {
        const gen = RpcApi.RemoteListEntriesCommand(
            TabRpcClient,
            { path: canvasDesignDir(cwd) },
            { route: makeConnRoute(null) }
        );
        for await (const chunk of gen) {
            entries.push(...(chunk.fileinfo ?? []));
        }
    } catch {
        return [];
    }
    return canvasTopics(entries);
}
