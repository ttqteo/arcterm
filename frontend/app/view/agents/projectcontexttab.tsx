// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Setup → Project: every file that shapes a Claude Code agent in one registered project (ClaudeContextCommand),
// grouped, with the selected one read in the rail. Read-only: nothing here writes a file. The model is
// claudecontextmodel.ts, the state setupstore.ts.

import { Markdown } from "@/app/element/markdown";
import { splitFrontmatter } from "@/app/view/code/codefrontmatter";
import { FrontmatterCard } from "@/app/view/code/frontmattercard";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { RotateCw } from "lucide-react";
import { motion } from "motion/react";
import { Fragment, useEffect, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { formatAgo } from "./agentsviewmodel";
import {
    contextFileKind,
    contextGroups,
    contextProject,
    contextSelection,
    type ContextGroup,
} from "./claudecontextmodel";
import { projectListAtom } from "./projectsstore";
import {
    loadClaudeContext,
    reloadClaudeContext,
    selectContextFile,
    selectContextProject,
    setupContextAtom,
    setupContextProjectAtom,
    setupContextSelectedAtom,
} from "./setupstore";
import { BTN_SECONDARY, FADE_IN, SECTION_HEAD } from "./setupstyles";
import { useFileText } from "./usefiletext";

export function ProjectContextHeader() {
    const data = useAtomValue(setupContextAtom);
    return (
        <button
            type="button"
            aria-label="Read the files again"
            title="Read the files again"
            disabled={data == null}
            onClick={() => fireAndForget(reloadClaudeContext)}
            className={cn(BTN_SECONDARY, "flex items-center gap-1.5")}
        >
            <RotateCw size={13} />
            Reload
        </button>
    );
}

function ProjectColumn({ projects, current }: { projects: { name: string; path: string }[]; current: string | null }) {
    return (
        <aside
            aria-label="Projects"
            className="flex w-[220px] flex-none flex-col gap-0.5 overflow-y-auto border-r border-border bg-surface px-2.5 py-3.5"
        >
            <div className={cn(SECTION_HEAD, "px-2.5 pb-1.5")}>Projects</div>
            {projects.map((p) => (
                <button
                    key={p.name}
                    type="button"
                    data-context-project={p.name}
                    aria-current={p.name === current || undefined}
                    onClick={() => selectContextProject(p.name)}
                    className={cn(
                        "flex w-full cursor-pointer flex-col gap-0.5 rounded border-0 px-2.5 py-[7px] text-left",
                        p.name === current ? "bg-surface-selected" : "bg-transparent hover:bg-surface-hover"
                    )}
                >
                    <span className="truncate text-[12.5px] font-medium text-primary">{p.name}</span>
                    <span className="truncate text-[10.5px] text-muted">{p.path}</span>
                </button>
            ))}
        </aside>
    );
}

function ContextRow({ row, selected, showNote }: { row: ClaudeContextFile; selected: boolean; showNote: boolean }) {
    if (!row.exists) {
        return (
            <div
                data-context-missing={row.label}
                className="flex items-center gap-2 px-2.5 py-[7px] text-[12.5px] text-ink-faint"
            >
                <span className="min-w-0 truncate">{row.label}</span>
                <span className="ml-auto flex-none">—</span>
            </div>
        );
    }
    return (
        <button
            type="button"
            data-context-file={row.path}
            aria-current={selected || undefined}
            onClick={() => selectContextFile(row.path)}
            className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded border-0 px-2.5 py-[7px] text-left text-[12.5px]",
                selected ? "bg-surface-selected text-primary" : "bg-transparent text-secondary hover:bg-surface-hover"
            )}
        >
            <span className="min-w-0 truncate">{row.label}</span>
            {showNote && row.note ? (
                <span data-context-note className="flex-none text-[11px] text-muted">
                    {row.note}
                </span>
            ) : null}
            <span className="ml-auto flex-none text-[11px] text-muted">
                {row.modts ? formatAgo(Date.now() - row.modts) : ""}
            </span>
        </button>
    );
}

// Global starts folded: those files apply to every project, and the tab is about this one. A memory row's note is its
// frontmatter type, which the section head already says, so memory rows draw none.
function ContextGroupView({ group, selected }: { group: ContextGroup; selected: string | null }) {
    const [open, setOpen] = useState(group.key !== "global");
    return (
        <section data-context-group={group.key} className="flex flex-col gap-0.5">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className="flex cursor-pointer items-center gap-2 border-0 bg-transparent px-2.5 pb-1 pt-2.5 text-left"
            >
                <span className={SECTION_HEAD}>{group.label}</span>
                <span className="text-[11px] text-muted">{group.count}</span>
            </button>
            {!open ? null : group.sections.length === 0 ? (
                <div data-context-empty className="px-2.5 py-[7px] text-[12.5px] text-ink-faint">
                    —
                </div>
            ) : (
                group.sections.map((s) => (
                    <Fragment key={s.head ?? ""}>
                        {s.head != null ? <div className="px-2.5 pt-1.5 text-[11px] text-muted">{s.head}</div> : null}
                        {s.rows.map((r) => (
                            <ContextRow
                                key={r.path}
                                row={r}
                                selected={r.path === selected}
                                showNote={group.key !== "memory"}
                            />
                        ))}
                    </Fragment>
                ))
            )}
        </section>
    );
}

function ContextRail({ row }: { row: ClaudeContextFile }) {
    const [file] = useFileText(row.path);
    const doc = file.status === "ok" && contextFileKind(row.path) === "markdown" ? splitFrontmatter(file.text) : null;
    return (
        <motion.aside
            key={row.path}
            {...FADE_IN}
            aria-label="File"
            data-context-rail={row.path}
            className="flex w-[440px] flex-none flex-col border-l border-border bg-surface"
        >
            <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
                <div className="flex flex-col gap-1.5">
                    <div className="text-[14px] font-medium text-primary">{row.label}</div>
                    {row.description ? (
                        <div className="text-[13px] leading-[1.5] text-secondary">{row.description}</div>
                    ) : null}
                    <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1 break-all text-[11px] text-muted">{row.path}</div>
                        <button
                            type="button"
                            data-context-copy
                            onClick={() => fireAndForget(() => navigator.clipboard.writeText(row.path))}
                            className={cn(BTN_SECONDARY, "flex-none")}
                        >
                            Copy path
                        </button>
                    </div>
                </div>
                {file.status === "loading" ? (
                    <div className="text-[12.5px] text-muted">Reading…</div>
                ) : file.status === "error" ? (
                    <div className="text-[12.5px] text-muted">Empty, or could not be read.</div>
                ) : doc != null ? (
                    <Markdown
                        text={doc.body}
                        header={doc.fields.length > 0 ? <FrontmatterCard fields={doc.fields} /> : null}
                        scrollable={false}
                        className="markdown-doc markdown-rail"
                        contentClassName="p-0"
                        fontSizeOverride={14}
                        resolveOpts={{ connName: "local", baseDir: row.path.replace(/[\\/][^\\/]*$/, "") }}
                    />
                ) : (
                    <pre className="m-0 whitespace-pre-wrap break-all font-mono text-[12px] leading-[1.5] text-secondary">
                        {file.text}
                    </pre>
                )}
            </div>
        </motion.aside>
    );
}

export function ProjectContextTab({ model }: { model: AgentsViewModel }) {
    const projects = useAtomValue(projectListAtom);
    const filter = useAtomValue(model.projectFilterAtom);
    const chosen = useAtomValue(setupContextProjectAtom);
    const data = useAtomValue(setupContextAtom);
    const selectedPath = useAtomValue(setupContextSelectedAtom);
    const name = contextProject(projects, chosen, filter);
    const project = projects.find((p) => p.name === name) ?? null;
    // re-read on every visit and project change: an agent may have written memory or settings since
    useEffect(() => {
        if (project != null) {
            fireAndForget(() => loadClaudeContext(project.name, project.path));
        }
    }, [project?.name, project?.path]);
    if (name == null) {
        return (
            <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
                No projects yet. Add one from the project switcher in the app bar.
            </div>
        );
    }
    const loaded = data != null && data.project === name ? data : null;
    const groups = loaded == null || loaded.error != null ? null : contextGroups(loaded.files);
    const selected = groups == null ? null : contextSelection(groups, selectedPath);
    const row = groups?.flatMap((g) => g.sections.flatMap((s) => s.rows)).find((r) => r.path === selected) ?? null;
    return (
        <div className="flex min-h-0 flex-1" data-context-tab>
            <ProjectColumn projects={projects} current={name} />
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-2.5 pb-4 pt-1">
                {loaded == null ? (
                    <div className="flex flex-1 items-center justify-center text-[13px] text-muted">Reading…</div>
                ) : loaded.error != null ? (
                    <div
                        role="alert"
                        className="m-2.5 rounded border border-error/30 bg-error/10 px-3 py-2 text-[12.5px] text-error-soft"
                    >
                        {loaded.error}
                    </div>
                ) : (
                    groups!.map((g) => <ContextGroupView key={g.key} group={g} selected={selected} />)
                )}
            </div>
            {row != null ? <ContextRail row={row} /> : null}
        </div>
    );
}
