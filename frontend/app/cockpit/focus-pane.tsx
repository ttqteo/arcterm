// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Renders the focused agent's terminal block in-place — the cockpit's replacement for
// setActiveTab(agent.id). The term view registers its own wshrpc route in its ctor (works because
// bootWaveCore connected the global client) and unregisters it in dispose(), so we recreate the
// model on blockId change and dispose the previous one to avoid leaking FE block routes.
//
// It is also where things are dropped on a terminal. An OS file is copied to a temp file and its path pasted into
// this block's terminal (uploadsingest.ts). Paths dragged from the Worktree files tree (pathdrop.ts) are already on
// disk: the drop types them at the prompt, `@`-mentioned for an agent, and copies nothing. An agent row being dragged
// into the grid carries its own MIME and is left alone (isFileDrag, isAgentDrag).
import { makeViewModel } from "@/app/block/blockregistry";
import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { getTabModelByTabId, TabModelContext } from "@/app/store/tab-model";
import * as WOS from "@/app/store/wos";
import { resolveCwd } from "@/app/view/agents/agentcwdresolve";
import { devRosterAtom } from "@/app/view/agents/devmock";
import { dropTargetFor } from "@/app/view/agents/droptarget";
import { isAgentDrag } from "@/app/view/agents/griddrop";
import { liveAgentsAtom } from "@/app/view/agents/liveagents";
import {
    decodePathsDrag,
    draggedPathsCount,
    formatDroppedPaths,
    isPathsDrag,
    RAIL_PATHS_MIME,
    type DropTarget,
} from "@/app/view/agents/pathdrop";
import { collectDroppedFiles, isFileDrag } from "@/app/view/agents/uploadfile";
import { ingestFiles } from "@/app/view/agents/uploadsingest";
import { focusTerm, pasteIntoTerm } from "@/app/view/term/termpaste";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { fireAndForget } from "@/util/util";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { makeSyntheticNodeModel } from "./synthetic-node-model";

// what is being dragged over the pane, which is also the wording of its drop hint
type DragHint = "file" | "path" | "paths";

function dragHintFor(types: readonly string[]): DragHint | null {
    if (isPathsDrag(types) && !isAgentDrag(types)) {
        // a browser hides a drag's payload until the drop, so the count is the one the tree recorded at dragstart
        return draggedPathsCount() > 1 ? "paths" : "path";
    }
    return isFileDrag(types) ? "file" : null;
}

// The dropped-on block as pathdrop.ts's formatDroppedPaths wants it. Which rows are agents is the cockpit roster's
// (the base of the Agent surface's agentsAtom, as agents.tsx picks it: pending launches have no block yet); an agent's
// cwd is resolved as the Files tab roots at it, and a plain terminal's is its `cmd:cwd` meta.
async function dropTargetOf(blockId: string): Promise<DropTarget> {
    const roster = globalStore.get(import.meta.env.DEV ? devRosterAtom : liveAgentsAtom);
    const agent = roster.find((a) => a.kind !== "terminal" && a.blockId === blockId);
    const agents = agent == null ? [] : [{ blockId, cwd: await resolveCwd(agent.transcriptPath, blockId) }];
    const meta = WOS.getObjectValue<Block>(WOS.makeORef("block", blockId))?.meta?.["cmd:cwd"];
    return dropTargetFor(blockId, agents, typeof meta === "string" ? meta : null);
}

// Types the dragged paths at the prompt of the block's terminal: one paste, no Enter, then the terminal takes focus.
async function insertDroppedPaths(blockId: string, data: string): Promise<void> {
    const paths = decodePathsDrag(data);
    if (paths == null) {
        console.warn("paths drop: the payload is not a JSON array of paths", data);
        pushToast({ title: "Could not read the dragged paths", message: "", level: "warn" });
        return;
    }
    if (paths.length === 0) {
        return;
    }
    try {
        const text = formatDroppedPaths(paths, await dropTargetOf(blockId));
        if (!pasteIntoTerm(blockId, text)) {
            pushToast({ title: "The terminal is not ready for input", message: "", level: "warn" });
            return;
        }
        focusTerm(blockId);
    } catch (err) {
        console.error("paths drop: could not insert the paths", err);
        pushToast({
            title: "Could not insert the paths",
            message: err instanceof Error ? err.message : String(err),
            level: "error",
        });
    }
}

export function CockpitFocusPane({ blockId, tabId }: { blockId: string; tabId: string }) {
    const waveEnv = useWaveEnv();
    const blockRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    // the term view reads useTabModel() — provide the block's own tab model (matches app.tsx)
    const tabModel = useMemo(() => getTabModelByTabId(tabId, waveEnv), [tabId, waveEnv]);
    const model = useMemo(
        () => makeViewModel(blockId, "term", makeSyntheticNodeModel(blockId), tabModel, waveEnv),
        [blockId, tabModel, waveEnv]
    );
    useEffect(() => () => model.dispose?.(), [model]);
    const VC = model.viewComponent;

    // an OS file or Worktree files paths over the pane: a drop hint while they are there, taken on drop
    const [dragOver, setDragOver] = useState<DragHint | null>(null);
    const onDragOver = (e: DragEvent<HTMLDivElement>) => {
        const hint = dragHintFor(e.dataTransfer.types);
        if (hint == null) {
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(hint);
    };
    const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDragOver(null);
        }
    };
    const onDrop = (e: DragEvent<HTMLDivElement>) => {
        const hint = dragHintFor(e.dataTransfer.types);
        if (hint == null) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        setDragOver(null);
        // read now: a drag's data is only readable while this event runs
        if (hint !== "file") {
            const data = e.dataTransfer.getData(RAIL_PATHS_MIME);
            fireAndForget(() => insertDroppedPaths(blockId, data));
            return;
        }
        const { files, rejected } = collectDroppedFiles(e.dataTransfer.items, e.dataTransfer.files);
        fireAndForget(() => ingestFiles(blockId, files, rejected));
    };

    return (
        <TabModelContext.Provider value={tabModel}>
            <div
                className="cockpit-focus-pane"
                ref={contentRef}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
            >
                <VC blockId={blockId} blockRef={blockRef} contentRef={contentRef} model={model} />
                {dragOver != null ? (
                    // only while an OS file or paths are over the pane, and it takes no pointer events, so it never
                    // sits in the way of the terminal
                    <div
                        aria-hidden="true"
                        data-upload-drop=""
                        {...(dragOver !== "file" ? { "data-paths-drop": "" } : {})}
                        className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border border-accent bg-accentbg"
                    >
                        <span className="rounded-[8px] bg-surface px-[12px] py-[6px] text-[12px] font-semibold text-accent-soft">
                            {dragOver === "file"
                                ? "Drop to paste the file path"
                                : dragOver === "paths"
                                  ? "Drop to insert the paths"
                                  : "Drop to insert the path"}
                        </span>
                    </div>
                ) : null}
            </div>
        </TabModelContext.Provider>
    );
}
