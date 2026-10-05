// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Renders the focused agent's terminal block in-place — the cockpit's replacement for
// setActiveTab(agent.id). The term view registers its own wshrpc route in its ctor (works because
// bootWaveCore connected the global client) and unregisters it in dispose(), so we recreate the
// model on blockId change and dispose the previous one to avoid leaking FE block routes.
//
// It is also where OS files are dropped on a terminal: the drop copies each file to a temp file and pastes its
// path into this block's terminal (uploadsingest.ts). An agent row being dragged into the grid carries its own
// MIME and is left alone (isFileDrag).
import { makeViewModel } from "@/app/block/blockregistry";
import { getTabModelByTabId, TabModelContext } from "@/app/store/tab-model";
import { collectDroppedFiles, isFileDrag } from "@/app/view/agents/uploadfile";
import { ingestFiles } from "@/app/view/agents/uploadsingest";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { fireAndForget } from "@/util/util";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { makeSyntheticNodeModel } from "./synthetic-node-model";

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

    // an OS file over the pane: a drop hint while it is there, the files taken on drop
    const [fileOver, setFileOver] = useState(false);
    const onDragOver = (e: DragEvent<HTMLDivElement>) => {
        if (!isFileDrag(e.dataTransfer.types)) {
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setFileOver(true);
    };
    const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setFileOver(false);
        }
    };
    const onDrop = (e: DragEvent<HTMLDivElement>) => {
        if (!isFileDrag(e.dataTransfer.types)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        setFileOver(false);
        // read now: a DataTransferItem is only valid while this event runs
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
                {fileOver ? (
                    // only while an OS file is over the pane, and it takes no pointer events, so it never sits in
                    // the way of the terminal
                    <div
                        aria-hidden="true"
                        data-upload-drop=""
                        className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border border-accent bg-accentbg"
                    >
                        <span className="rounded-[8px] bg-surface px-[12px] py-[6px] text-[12px] font-semibold text-accent-soft">
                            Drop to paste the file path
                        </span>
                    </div>
                ) : null}
            </div>
        </TabModelContext.Provider>
    );
}
