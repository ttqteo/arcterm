// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Work on an initiative that has no project: rather than a toast saying so, ask which project the agent starts in,
// save it on the initiative (so the next Work on goes straight there), then run the launch that was waiting.
// workOnInitiative sets projectAskAtom; the cockpit root mounts this, since the palette and Needs you start a
// launch from any surface.

import { DialogButton } from "@/app/modals/dialogbutton";
import { ModalShell } from "@/app/modals/modalshell";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { projectListAtom, recentProjectsAtom } from "@/app/view/agents/projectsstore";
import { formatChordString } from "@/util/keysym";
import { useAtomValue } from "jotai";
import { FolderPlus } from "lucide-react";
import { useState } from "react";
import { setEffortProject } from "./effortstore";
import { projectAskAtom, workOnInitiative } from "./initiativeworkaction";
import { ProjectChips } from "./projectchips";

export function InitiativeProjectPicker({ model }: { model: AgentsViewModel }) {
    const pending = useAtomValue(projectAskAtom);
    const rows = useAtomValue(projectListAtom);
    const recent = useAtomValue(recentProjectsAtom);
    const [picked, setPicked] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const open = pending != null;
    const names = rows.map((r) => r.name);
    const lastUsed = recent.find((n) => names.includes(n)) ?? null;

    const close = () => {
        globalStore.set(projectAskAtom, null);
        setPicked(null);
        setSaving(false);
        setError(null);
    };
    const start = async () => {
        if (pending == null || picked == null || saving) {
            return;
        }
        setSaving(true);
        try {
            await setEffortProject(pending.target.oref, picked);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setSaving(false);
            return;
        }
        close();
        await workOnInitiative(model, { ...pending.target, project: picked }, pending.ask);
    };
    // the launcher's Register does the same: this closes, New project opens, and Work on is pressed again after
    const newProject = () => {
        close();
        globalStore.set(model.newProjectOpenAtom, true);
    };

    return (
        <ModalShell
            open={open}
            onClose={close}
            onSubmit={() => void start()}
            className="w-[min(480px,92vw)]"
            topClass="pt-[14vh]"
        >
            {open ? (
                <div data-initiative-project-picker>
                    <div className="flex items-center gap-[11px] border-b border-border px-[18px] py-[15px]">
                        <span className="flex-1 text-[15px] font-semibold text-primary">Choose a project</span>
                        <span className="rounded-[5px] border border-edge-mid px-[7px] py-0.5 font-mono text-[10.5px] text-muted">
                            esc
                        </span>
                    </div>
                    <div className="flex flex-col gap-3 px-[18px] py-4">
                        <div className="text-[12.5px] leading-[1.5] text-secondary">
                            <span className="font-semibold text-primary">“{pending.target.title}”</span> has no project.
                            The agent starts in the one you pick, and the initiative keeps it.
                        </div>
                        {names.length > 0 ? (
                            <ProjectChips
                                names={names}
                                picked={picked}
                                recent={lastUsed}
                                onPick={(name) => {
                                    setPicked(name);
                                    setError(null);
                                }}
                                columns={2}
                                // Enter in the search box picks the first project it shows
                                onKeyDown={(e, visible) => {
                                    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && visible.length > 0) {
                                        e.preventDefault();
                                        setPicked(visible[0]);
                                    }
                                }}
                            />
                        ) : (
                            <div className="text-[12.5px] text-muted">
                                No projects yet. Make one, then press Work on again.
                            </div>
                        )}
                        {error ? <div className="text-[12px] text-error">{error}</div> : null}
                    </div>
                    <div className="flex items-center gap-3 border-t border-border px-[18px] py-[13px]">
                        <button
                            type="button"
                            onClick={newProject}
                            className="flex cursor-pointer items-center gap-1.5 text-[12.5px] font-medium text-muted hover:text-primary"
                        >
                            <FolderPlus size={13} aria-hidden />
                            New project…
                        </button>
                        <div className="flex-1" />
                        <DialogButton variant="secondary" hint="esc" onClick={close}>
                            Cancel
                        </DialogButton>
                        <DialogButton
                            variant="primary"
                            hint={formatChordString("Cmd:Enter")}
                            disabled={picked == null || saving}
                            onClick={() => void start()}
                        >
                            Start agent
                        </DialogButton>
                    </div>
                </div>
            ) : null}
        </ModalShell>
    );
}
