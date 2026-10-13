// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Setup surface: the instructions and skills every harness reads. The Instructions tab edits the
// shared doc, which every save writes into each harness's file, and lists each harness file's state.
// The Skills tab views every harness's skills, moves them into the vault, and edits or creates a vault
// skill in its rail. The Tools tab is the library of terminal tools (toolslibrary.tsx). Logic lives in setupmodel.ts and
// skillsmatrix.ts, the RPCs and the atoms in setupstore.ts.

import { openFileInCode } from "@/app/cockpit/openfilestore";
import { Markdown } from "@/app/element/markdown";
import { composerReveal, MOTION } from "@/app/element/motiontokens";
import { PaneReveal } from "@/app/element/panereveal";
import { globalStore } from "@/app/store/jotaiStore";
import { FrontmatterCard } from "@/app/view/code/frontmattercard";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Share2, TriangleAlert } from "lucide-react";
import { motion, MotionConfig } from "motion/react";
import { Fragment, useEffect, type KeyboardEvent } from "react";
import type { AgentsViewModel } from "./agents";
import { formatAgo } from "./agentsviewmodel";
import { RuntimeMark } from "./runtimemark";
import { runtimeMeta } from "./runtimemeta";
import {
    changedLineCount,
    harnessRowLabel,
    harnessRowState,
    harnessRowTone,
    headerStatus,
    isDirty,
    lineCount,
    saveTargetCount,
    type DocEditor,
    type Tone,
} from "./setupmodel";
import {
    adoptSkills,
    closeNewSkill,
    closeSkillEditor,
    createSkill,
    discardShared,
    editSkill,
    loadSetup,
    loadSkills,
    openNewSkill,
    openSkillFile,
    reloadShared,
    reloadSkill,
    saveShared,
    saveSkill,
    selectSkill,
    setSkillKeep,
    setupBusyAtom,
    setupErrorAtom,
    setupNewSkillAtom,
    setupSharedAtom,
    setupSharedPathAtom,
    setupSkillEditorsAtom,
    setupSkillKeepAtom,
    setupSkillsAtom,
    setupSkillSelectedAtom,
    setupStatusAtom,
    setupTabAtom,
    typeNewSkill,
    typeShared,
    typeSkill,
    type SetupTab,
} from "./setupstore";
import {
    adoptCount,
    copyDelta,
    manageLabel,
    MAX_SKILL_NAME,
    skillCopyTargets,
    skillFilePath,
    skillFileSource,
    skillGroups,
    skillLinkTarget,
    skillNameError,
    skillNote,
    skillPreview,
    skillsSummary,
    type SkillCell,
    type SkillGroup,
    type SkillPreview,
    type SkillRow,
} from "./skillsmatrix";
import { ToolsHeader, ToolsLibrary } from "./toolslibrary";
import { fileTextOf, useFileText } from "./usefiletext";

const SECTION_HEAD = cn(REGION_LABEL, "text-muted");
const BTN_SECONDARY =
    "h-[30px] cursor-pointer rounded border border-edge-mid bg-surface-raised px-3 text-[12.5px] font-semibold text-ink-mid hover:border-edge-strong hover:bg-surface-hover hover:text-primary disabled:cursor-default disabled:text-ink-faint disabled:hover:border-edge-mid disabled:hover:bg-surface-raised";
const BTN_PRIMARY =
    "h-8 cursor-pointer rounded border-0 bg-accent px-[14px] text-[13px] font-bold text-background shadow-inset-highlight hover:bg-accenthover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-accent";

const INPUT =
    "h-[30px] min-w-0 rounded-[7px] border border-edge-mid bg-background px-2.5 text-[13px] text-primary outline-none placeholder:text-muted focus:border-accent";

const TONE_DOT: Record<Tone, string> = { ok: "bg-success", warn: "bg-warning", none: "bg-ink-faint" };
const TONE_TEXT: Record<Tone, string> = { ok: "text-ink-mid", warn: "text-warning-soft", none: "text-muted" };

// a swapped tab or skill fades in rather than cutting; the outgoing one leaves at once, so a quick run of
// arrow keys through the skill list never queues exits
const FADE_IN = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: MOTION.durMicro, ease: MOTION.easeFluid },
};

const TABS: { key: SetupTab; label: string }[] = [
    { key: "instructions", label: "Instructions" },
    { key: "skills", label: "Skills" },
    { key: "tools", label: "Tools" },
];

function useRows(): AgentSyncHarness[] {
    return useAtomValue(setupStatusAtom)?.harnesses ?? [];
}

function Dot({ tone, size = 6 }: { tone: Tone; size?: 6 | 7 }) {
    return (
        <span
            className={cn("flex-none rounded-full", TONE_DOT[tone], size === 7 ? "h-[7px] w-[7px]" : "h-1.5 w-1.5")}
        />
    );
}

function HarnessMark({ runtime }: { runtime: string }) {
    const meta = runtimeMeta(runtime);
    return (
        <span
            className={cn(
                "flex flex-none items-center justify-center rounded-[5px] border text-[10.5px] font-bold",
                meta.line,
                meta.text,
                "h-5 w-5"
            )}
        >
            <RuntimeMark runtime={runtime} imageClassName="h-3 w-3" />
        </span>
    );
}

// the folder truncates and the file name never does: every path here starts with the same home prefix,
// so a plain tail ellipsis hid the one part that tells two rows apart
function PathTail({ path }: { path: string }) {
    const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
    return (
        <span title={path} className="flex min-w-0 text-[10.5px] text-muted">
            <span className="truncate">{path.slice(0, cut)}</span>
            <span className="flex-none">{path.slice(cut)}</span>
        </span>
    );
}

function Tabs() {
    const tab = useAtomValue(setupTabAtom);
    const onKey = (e: KeyboardEvent) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") {
            return;
        }
        e.preventDefault();
        const i = TABS.findIndex((t) => t.key === tab);
        const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
        globalStore.set(setupTabAtom, next.key);
        document.getElementById(`setup-tab-${next.key}`)?.focus();
    };
    return (
        <div
            role="tablist"
            aria-label="Setup"
            onKeyDown={onKey}
            className="flex gap-0.5 rounded border border-border bg-surface p-[3px]"
        >
            {TABS.map((t) => (
                <button
                    key={t.key}
                    id={`setup-tab-${t.key}`}
                    data-setup-tab={t.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.key}
                    aria-controls="setup-tabpanel"
                    tabIndex={tab === t.key ? 0 : -1}
                    onClick={() => globalStore.set(setupTabAtom, t.key)}
                    className={cn(
                        "cursor-pointer rounded-md border-0 px-3 py-[5px] text-[13px]",
                        tab === t.key
                            ? "bg-surface-selected font-semibold text-primary"
                            : "bg-transparent font-medium text-ink-mid hover:text-primary"
                    )}
                >
                    {t.label}
                </button>
            ))}
        </div>
    );
}

function HeaderStatus() {
    const rows = useRows();
    const status = useAtomValue(setupStatusAtom);
    if (status == null) {
        return null;
    }
    const s = headerStatus(rows);
    return (
        <div
            className={cn(
                "flex items-center gap-2 text-[12px]",
                s.tone === "warn" ? "text-warning-soft" : "text-ink-mid"
            )}
        >
            <Dot tone={s.tone} size={7} />
            {s.text}
        </div>
    );
}

// ---- left list ----

function FileList({ rows }: { rows: AgentSyncHarness[] }) {
    const shared = useAtomValue(setupSharedAtom);
    const status = useAtomValue(setupStatusAtom);
    const rowClass = "flex w-full items-start gap-2.5 rounded px-2.5 py-[9px]";
    return (
        <aside
            aria-label="Instruction files"
            className="flex w-[264px] flex-none flex-col gap-1 overflow-y-auto border-r border-border bg-surface px-2.5 py-3.5"
        >
            <div className={cn(SECTION_HEAD, "px-2 pb-1.5")}>Shared</div>
            <div className={cn(rowClass, "bg-surface-selected text-primary ring-1 ring-edge-strong ring-inset")}>
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-[5px] bg-accentbg text-accent-soft">
                    <Share2 size={12} strokeWidth={2.2} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2 text-[13px] font-semibold">
                        For every harness
                        {isDirty(shared) ? (
                            <span
                                aria-label="Unsaved changes"
                                title="Unsaved changes"
                                className="ml-auto h-[7px] w-[7px] rounded-full bg-accent"
                            />
                        ) : null}
                    </span>
                    <span className="text-[10.5px] text-muted">vault/steering/AGENTS.md</span>
                </span>
            </div>

            <div className={cn(SECTION_HEAD, "px-2 pb-1.5 pt-4")}>Harness files</div>
            {status == null ? <div className="px-2 text-[12px] text-muted">Reading…</div> : null}
            {rows.map((r) => {
                const state = harnessRowState(r);
                const tone = harnessRowTone(state);
                return (
                    <div key={r.runtime} className={cn(rowClass, "text-secondary", !r.present && "opacity-50")}>
                        <HarnessMark runtime={r.runtime} />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="text-[13px] font-medium">{r.label}</span>
                            <PathTail path={r.path} />
                            <span className={cn("mt-[3px] flex items-center gap-1.5 text-[11px]", TONE_TEXT[tone])}>
                                <Dot tone={tone} />
                                {harnessRowLabel(state)}
                            </span>
                        </span>
                    </div>
                );
            })}
        </aside>
    );
}

// ---- shared doc ----

function ConflictNotice({
    onReload,
    onOverwrite,
    busy,
}: {
    onReload: () => void;
    onOverwrite: () => void;
    busy: boolean;
}) {
    return (
        <div
            role="alert"
            className="flex items-center gap-3 rounded border border-warning/30 bg-warning/10 px-3.5 py-2.5"
        >
            <TriangleAlert size={16} strokeWidth={2} className="flex-none text-warning" />
            <span className="min-w-0 flex-1 text-[12.5px] text-secondary">
                <span className="font-semibold text-warning-soft">Changed on disk since you opened it.</span> Reload to
                take the file as it is now and lose your edits, or overwrite it with yours.
            </span>
            <button type="button" disabled={busy} onClick={onReload} className={BTN_SECONDARY}>
                Reload
            </button>
            <button type="button" disabled={busy} onClick={onOverwrite} className={BTN_SECONDARY}>
                Overwrite
            </button>
        </div>
    );
}

function LineEditor({
    ed,
    onChange,
    path,
    placeholder,
    label,
}: {
    ed: DocEditor;
    onChange: (v: string) => void;
    path: string;
    placeholder: string;
    label: string;
}) {
    const lines = ed.draft.split("\n");
    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-edge-mid bg-surface-code focus-within:ring-2 focus-within:ring-accent/25">
            <div className="flex h-[30px] flex-none items-center gap-2.5 border-b border-edge-faint px-3 text-[11px] tabular-nums text-muted">
                <span title={path} className="min-w-0 truncate">
                    {path}
                </span>
                <span className="flex-1" />
                <span className="flex-none">Markdown</span>
                <span className="flex-none text-muted">·</span>
                <span className="flex-none whitespace-nowrap">
                    {lineCount(ed.draft)} {lineCount(ed.draft) === 1 ? "line" : "lines"}
                </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-2 pr-4 font-mono text-[12.5px] leading-[21px]">
                {/* lines soft-wrap, so each row holds a number beside an invisible copy of its line: the row
                    takes the wrapped height and the number stays level with the line the textarea draws over it.
                    the last 1fr row lets the textarea fill the rest of the box. */}
                <div
                    className="grid min-h-full"
                    style={{ gridTemplateColumns: "2.5rem 1fr", gridTemplateRows: `repeat(${lines.length}, auto) 1fr` }}
                >
                    {lines.map((line, i) => (
                        <Fragment key={i}>
                            <div
                                aria-hidden
                                style={{ gridRow: i + 1 }}
                                className="pr-3 text-right text-ink-faint select-none"
                            >
                                {i + 1}
                            </div>
                            {/* placed by row: the textarea already holds column 2, so auto-placement would skip it */}
                            <div
                                aria-hidden
                                style={{ gridRow: i + 1, gridColumn: 2 }}
                                className="invisible whitespace-pre-wrap break-words"
                            >
                                {line || " "}
                            </div>
                        </Fragment>
                    ))}
                    <textarea
                        aria-label={label}
                        value={ed.draft}
                        spellCheck={false}
                        rows={1}
                        placeholder={placeholder}
                        onChange={(e) => onChange(e.target.value)}
                        style={{ gridColumn: 2, gridRow: "1 / -1" }}
                        className="h-full resize-none overflow-hidden border-0 bg-transparent p-0 text-secondary outline-none placeholder:text-muted"
                    />
                </div>
            </div>
        </div>
    );
}

function SharedEditor({ rows }: { rows: AgentSyncHarness[] }) {
    const ed = useAtomValue(setupSharedAtom);
    const path = useAtomValue(setupSharedPathAtom);
    const busy = useAtomValue(setupBusyAtom);
    const dirty = isDirty(ed);
    const n = saveTargetCount(rows);
    const changed = changedLineCount(ed.base, ed.draft);
    return (
        <div className="flex min-w-0 flex-1 flex-col gap-3 px-5 pb-5 pt-4">
            <div className="flex items-center gap-3.5">
                <div className="flex min-w-0 flex-col gap-[3px]">
                    <div className="text-[15px] font-semibold text-primary">Instructions for every harness</div>
                    <div className="text-[12px] text-muted">Saving writes this into each harness file below.</div>
                </div>
                <div className="flex-1" />
                {dirty ? (
                    <span className="text-[12px] text-accent-soft">
                        {changed} {changed === 1 ? "line" : "lines"} changed
                    </span>
                ) : null}
                <button
                    type="button"
                    disabled={!dirty || busy}
                    onClick={discardShared}
                    className={cn(BTN_SECONDARY, "h-8 text-[13px]")}
                >
                    Discard
                </button>
                <button
                    type="button"
                    disabled={!dirty || busy || n === 0}
                    onClick={() => fireAndForget(() => saveShared(false))}
                    className={BTN_PRIMARY}
                >
                    {busy ? "Saving…" : `Save to ${n} ${n === 1 ? "harness" : "harnesses"}`}
                </button>
            </div>
            <PaneReveal open={!!ed.conflict} variants={composerReveal} className="flex-none">
                <ConflictNotice
                    busy={busy}
                    onReload={() => fireAndForget(reloadShared)}
                    onOverwrite={() => fireAndForget(() => saveShared(true))}
                />
            </PaneReveal>
            <LineEditor
                ed={ed}
                path={path}
                onChange={typeShared}
                label="Instructions for every harness"
                placeholder="The instructions every harness should follow. Saving writes them into each harness's file."
            />
        </div>
    );
}

function SharedRail({ rows }: { rows: AgentSyncHarness[] }) {
    const ed = useAtomValue(setupSharedAtom);
    return (
        <aside
            aria-label="Where this goes"
            className="flex w-[300px] flex-none flex-col gap-[18px] overflow-y-auto border-l border-border bg-surface px-4 py-[18px]"
        >
            <div className="flex flex-col gap-2">
                <div className={SECTION_HEAD}>How saving works</div>
                <p className="m-0 text-[12px] leading-[1.45] text-ink-mid">
                    Each harness file gets this doc between two arcterm marker lines. Anything outside them is left alone.
                </p>
            </div>
            <div className="flex flex-col gap-2">
                <div className={SECTION_HEAD}>Saving writes to</div>
                {rows
                    .filter((r) => r.present)
                    .map((r) => (
                        <div
                            key={r.runtime}
                            className="flex flex-col gap-[3px] rounded border border-border px-2.5 py-2"
                        >
                            <span className="flex items-center gap-2 text-[12.5px] font-semibold text-secondary">
                                {r.label}
                            </span>
                            <PathTail path={r.path} />
                        </div>
                    ))}
            </div>
            <div className="flex-1" />
            <div className="text-[11.5px] leading-[1.5] text-muted">
                {ed.mtime > 0 ? `Last saved ${formatAgo(Math.max(0, Date.now() - ed.mtime))}.` : "Not saved yet."} arcterm
                also re-applies this on every launch.
            </div>
        </aside>
    );
}

// ---- tabs ----

function ErrorBanner({ error }: { error: string | null }) {
    return (
        <PaneReveal open={!!error} variants={composerReveal} className="flex-none">
            <div role="alert" className="border-b border-error/30 bg-error/10 px-5 py-2 text-[12.5px] text-error-soft">
                {error}
            </div>
        </PaneReveal>
    );
}

function InstructionsTab() {
    const rows = useRows();
    const error = useAtomValue(setupErrorAtom);
    const status = useAtomValue(setupStatusAtom);
    return (
        <div className="flex min-h-0 flex-1">
            <FileList rows={rows} />
            <div className="flex min-w-0 flex-1 flex-col">
                <ErrorBanner error={error} />
                <div className="flex min-h-0 flex-1">
                    {status == null ? (
                        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">Reading…</div>
                    ) : (
                        <>
                            <SharedEditor rows={rows} />
                            <SharedRail rows={rows} />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ---- skills ----

const SKILL_COLUMN_WIDTH = "118px";

function useSkillGroups(): { data: CommandAgentSyncSkillsRtnData | null; groups: SkillGroup[] } {
    const data = useAtomValue(setupSkillsAtom);
    const keep = useAtomValue(setupSkillKeepAtom);
    return { data, groups: data == null ? [] : skillGroups(data, keep) };
}

function SkillsHeader() {
    const data = useAtomValue(setupSkillsAtom);
    const keep = useAtomValue(setupSkillKeepAtom);
    const busy = useAtomValue(setupBusyAtom);
    if (data == null) {
        return null;
    }
    const n = adoptCount(data, keep);
    return (
        <>
            <span className="text-[12px] text-ink-mid">{skillsSummary(data)}</span>
            <button
                type="button"
                data-skill-new
                disabled={busy}
                onClick={openNewSkill}
                className={cn(BTN_SECONDARY, "h-8 text-[13px]")}
            >
                New skill
            </button>
            <button
                type="button"
                disabled={busy || n === 0}
                onClick={() => fireAndForget(adoptSkills)}
                className={BTN_PRIMARY}
            >
                {manageLabel(n)}
            </button>
        </>
    );
}

function SkillCellView({ cell }: { cell: SkillCell }) {
    return (
        <span
            role="cell"
            title={cell.title}
            className={cn(
                "flex min-w-0 items-center gap-1.5 text-[11.5px]",
                cell.tone == null ? "text-muted" : TONE_TEXT[cell.tone]
            )}
        >
            {cell.tone != null ? <Dot tone={cell.tone} /> : null}
            <span className="truncate">{cell.label}</span>
        </span>
    );
}

function SkillsMatrix({
    columns,
    groups,
    selected,
}: {
    columns: AgentSyncSkillColumn[];
    groups: SkillGroup[];
    selected: string | null;
}) {
    const editors = useAtomValue(setupSkillEditorsAtom);
    // the column count comes from the backend, so the template cannot be a static utility
    const grid = { gridTemplateColumns: `minmax(0, 1fr) repeat(${columns.length}, ${SKILL_COLUMN_WIDTH})` };
    const onKey = (e: KeyboardEvent, name: string) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectSkill(name);
        }
    };
    return (
        <div
            role="table"
            aria-label="Skills by harness"
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-edge-mid bg-surface"
        >
            <div
                role="row"
                style={grid}
                className="grid min-h-9 flex-none items-center border-b border-edge-mid bg-surface-raised px-3 py-1 text-[11px] font-bold tracking-[0.04em] text-ink-mid"
            >
                <span role="columnheader">Skill</span>
                {columns.map((c) => (
                    <span key={c.runtime} role="columnheader" className="flex min-w-0 flex-col gap-px">
                        <span className="flex items-center gap-1.5">
                            <HarnessMark runtime={c.runtime} />
                            <span className="truncate">{c.label}</span>
                        </span>
                        {c.present ? null : (
                            <span className="text-[10.5px] font-semibold tracking-normal text-warning">not set up</span>
                        )}
                    </span>
                ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {groups.length === 0 ? (
                    <div className="px-3 py-6 text-center text-[12.5px] text-muted">No skills in any harness.</div>
                ) : null}
                {groups.map((g) => (
                    <div key={g.key} role="rowgroup" aria-label={g.title}>
                        <div
                            className={cn(
                                REGION_LABEL,
                                "flex h-[26px] items-center gap-2 border-b border-edge-faint bg-background px-3 text-muted"
                            )}
                        >
                            {g.title}
                            <span className="font-medium normal-case tracking-normal text-muted">
                                · {g.rows.length}
                            </span>
                        </div>
                        {g.rows.map((r) => (
                            <div
                                key={r.name}
                                data-skill-row={r.name}
                                role="row"
                                tabIndex={0}
                                aria-selected={r.name === selected}
                                onClick={() => selectSkill(r.name)}
                                onKeyDown={(e) => onKey(e, r.name)}
                                style={grid}
                                className={cn(
                                    "grid h-7 cursor-pointer items-center border-b border-edge-faint px-3 outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset",
                                    r.name === selected
                                        ? "bg-surface-selected shadow-[inset_2px_0_0_var(--color-accent)]"
                                        : "hover:bg-surface-hover"
                                )}
                            >
                                <span role="cell" className="flex min-w-0 items-center gap-2 text-[12px] text-ink-hi">
                                    <span className="truncate">{r.name}</span>
                                    {editors[r.name] != null && isDirty(editors[r.name]) ? (
                                        <span className="flex-none text-[11px] text-accent-soft">edited</span>
                                    ) : null}
                                </span>
                                {r.cells.map((c) => (
                                    <SkillCellView key={c.runtime} cell={c} />
                                ))}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

function KeepChoice({ row }: { row: SkillRow }) {
    const keep = useAtomValue(setupSkillKeepAtom);
    const chosen = keep[row.name] ?? null;
    const option = (runtime: string | null, title: string, hint: string) => (
        <label
            key={runtime ?? ""}
            className={cn(
                "flex cursor-pointer items-start gap-2 rounded px-2.5 py-2 text-[12.5px] text-secondary",
                chosen === runtime ? "bg-surface-selected ring-1 ring-edge-strong ring-inset" : "hover:bg-surface-hover"
            )}
        >
            <input
                type="radio"
                name={`skill-keep-${row.name}`}
                checked={chosen === runtime}
                onChange={() => setSkillKeep(row.name, runtime)}
                className="mt-0.5 accent-accent"
            />
            <span className="flex flex-col gap-0.5">
                <span className="font-semibold">{title}</span>
                <span className="text-[11.5px] text-muted">{hint}</span>
            </span>
        </label>
    );
    return (
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className={cn(SECTION_HEAD, "pb-1.5")}>When arcterm manages it</legend>
            {row.copies.map((c) =>
                option(c.runtime, `Keep ${c.label}'s copy`, "Every harness gets it. The other copies are set aside.")
            )}
            {option(null, "Leave these copies alone", "arcterm skips this skill; each harness keeps its own file.")}
        </fieldset>
    );
}

// The kept SKILL.md read as a document under the rail's facts, so a skill can be read without leaving Setup.
// Relative links open their file in Code; the frontmatter card leaves out what the rail's head already shows.
function SkillFilePreview({ model, path, preview }: { model: AgentsViewModel; path: string; preview: SkillPreview }) {
    return (
        <Markdown
            text={preview.body}
            header={preview.fields.length > 0 ? <FrontmatterCard fields={preview.fields} /> : null}
            scrollable={false}
            className="markdown-doc markdown-rail"
            contentClassName="p-0"
            fontSizeOverride={14}
            resolveOpts={{ connName: "local", baseDir: path.replace(/[\\/][^\\/]*$/, "") }}
            onClickLink={(href) => {
                const target = skillLinkTarget(path, href);
                if (target == null) {
                    return false;
                }
                fireAndForget(() => openFileInCode(model, target.path, false, target.line ?? undefined));
                return true;
            }}
        />
    );
}

// The rail's footer: Edit for a vault skill of the user's, Discard and Save while editing it, Open in Code for a copy
// arcterm does not own yet. A shipped skill has no footer (SkillRail): every launch puts its vault copy back.
function SkillRailFooter({
    model,
    row,
    path,
    ed,
    onSaved,
}: {
    model: AgentsViewModel;
    row: SkillRow;
    path: string;
    ed: DocEditor | undefined;
    onSaved: (text: string) => void;
}) {
    const busy = useAtomValue(setupBusyAtom);
    if (row.kind !== "managed") {
        return (
            <button
                type="button"
                disabled={busy}
                onClick={() => fireAndForget(() => openSkillFile(model, path))}
                className={BTN_SECONDARY}
            >
                Open in Code
            </button>
        );
    }
    if (ed == null) {
        return (
            <button
                type="button"
                data-skill-edit
                disabled={busy}
                onClick={() => fireAndForget(() => editSkill(row.name))}
                className={BTN_SECONDARY}
            >
                Edit
            </button>
        );
    }
    const dirty = isDirty(ed);
    const changed = changedLineCount(ed.base, ed.draft);
    const save = async (overwrite: boolean) => {
        const text = await saveSkill(row.name, overwrite);
        if (text != null) {
            onSaved(text);
        }
    };
    return (
        <>
            <button
                type="button"
                data-skill-cancel
                disabled={busy}
                onClick={() => closeSkillEditor(row.name)}
                className={BTN_SECONDARY}
            >
                {dirty ? "Discard" : "Done"}
            </button>
            <span className="flex-1" />
            {dirty ? (
                <span className="text-[12px] text-accent-soft">
                    {changed} {changed === 1 ? "line" : "lines"} changed
                </span>
            ) : null}
            <button
                type="button"
                data-skill-save
                disabled={!dirty || busy}
                onClick={() => fireAndForget(() => save(false))}
                className={BTN_PRIMARY}
            >
                {busy ? "Saving…" : "Save"}
            </button>
        </>
    );
}

function SkillRail({
    model,
    row,
    skillsroot,
    columns,
}: {
    model: AgentsViewModel;
    row: SkillRow;
    skillsroot: string;
    columns: AgentSyncSkillColumn[];
}) {
    const keep = useAtomValue(setupSkillKeepAtom);
    const busy = useAtomValue(setupBusyAtom);
    const editors = useAtomValue(setupSkillEditorsAtom);
    const ed = row.kind === "managed" && !row.shipped ? editors[row.name] : undefined;
    const path = skillFilePath(row, skillsroot, keep);
    const [file, setFile] = useFileText(path);
    const preview = file.status === "ok" ? skillPreview(row, file.text) : null;
    const description = preview?.description ?? row.description;
    const source = skillFileSource(row, keep);
    const differs = row.kind === "decide" || row.kind === "differs";
    const targets = skillCopyTargets(row, columns);
    const card = "flex flex-col gap-[5px] rounded border border-border px-2.5 py-[9px]";
    return (
        <motion.aside
            key={row.name}
            {...FADE_IN}
            aria-label="Skill detail"
            data-skill-rail={row.name}
            className={cn(
                "flex flex-none flex-col border-l border-border bg-surface",
                ed != null ? "w-[600px]" : "w-[440px]"
            )}
        >
            {ed != null ? (
                <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
                    <div className="flex flex-col gap-1">
                        <div className="text-[14px] font-medium text-primary">Editing {row.name}</div>
                        <div className="text-[12.5px] leading-[1.5] text-muted">
                            Saving writes the vault copy and copies it into each harness's skills folder on this
                            machine.
                        </div>
                    </div>
                    <PaneReveal open={!!ed.conflict} variants={composerReveal} className="flex-none">
                        <ConflictNotice
                            busy={busy}
                            onReload={() => fireAndForget(() => reloadSkill(row.name))}
                            onOverwrite={() =>
                                fireAndForget(async () => {
                                    const text = await saveSkill(row.name, true);
                                    if (text != null) {
                                        setFile(fileTextOf(text));
                                    }
                                })
                            }
                        />
                    </PaneReveal>
                    <div data-skill-editor className="flex min-h-0 flex-1 flex-col">
                        <LineEditor
                            ed={ed}
                            path={path}
                            onChange={(v) => typeSkill(row.name, v)}
                            label={`SKILL.md of ${row.name}`}
                            placeholder={"---\nname: …\ndescription: Use when …\n---"}
                        />
                    </div>
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
                    <div className="flex flex-col gap-1.5">
                        <div className="text-[14px] font-medium text-primary">{row.name}</div>
                        {description ? (
                            <div className="text-[13px] leading-[1.5] text-secondary">{description}</div>
                        ) : null}
                        <div className="text-[12.5px] leading-[1.5] text-muted">{skillNote(row)}</div>
                    </div>
                    <div className="flex flex-col gap-2">
                        <div className={SECTION_HEAD}>{differs ? "What differs" : "Where it lives"}</div>
                        {row.kind === "managed" ? (
                            <>
                                <div className={card}>
                                    <span className="text-[12.5px] font-semibold text-secondary">arcterm vault</span>
                                    <span className="truncate text-[10.5px] text-muted">{path}</span>
                                </div>
                                {Object.entries(row.deltas).map(([runtime, over]) => (
                                    <div key={runtime} className={card}>
                                        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-secondary">
                                            <HarnessMark runtime={runtime} />
                                            {runtimeMeta(runtime).label}
                                        </span>
                                        <span className="text-[10.5px] text-muted">Overrides {over.join(", ")}</span>
                                    </div>
                                ))}
                            </>
                        ) : (
                            row.copies.map((c) => (
                                <div key={c.runtime} className={card}>
                                    <span className="flex items-center gap-2 text-[12.5px] font-semibold text-secondary">
                                        <HarnessMark runtime={c.runtime} />
                                        {c.label}
                                        {differs ? (
                                            <span className="ml-auto text-[11px] font-normal text-muted">
                                                {copyDelta(c)}
                                            </span>
                                        ) : null}
                                    </span>
                                    <PathTail path={c.path} />
                                </div>
                            ))
                        )}
                    </div>
                    {targets.length > 0 ? (
                        <div data-skill-copies className="flex flex-col gap-2">
                            <div className={SECTION_HEAD}>Copied into</div>
                            {targets.map((t) => (
                                <div key={t.runtime} className="flex min-w-0 items-center gap-2">
                                    <HarnessMark runtime={t.runtime} />
                                    <span className="flex-none text-[12px] text-secondary">{t.label}</span>
                                    <span title={t.path} className="min-w-0 truncate text-[11px] text-muted">
                                        {t.path}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {row.needsKeep ? <KeepChoice row={row} /> : null}
                    <div className="flex flex-col gap-2">
                        <div className="flex items-baseline gap-2">
                            <span className={SECTION_HEAD}>SKILL.md</span>
                            {source != null ? <span className="text-[11px] text-muted">{source}'s copy</span> : null}
                        </div>
                        {preview != null ? (
                            <SkillFilePreview model={model} path={path} preview={preview} />
                        ) : (
                            <div className="text-[12.5px] text-muted">
                                {file.status === "loading" ? "Reading…" : "SKILL.md could not be read."}
                            </div>
                        )}
                    </div>
                </div>
            )}
            {row.kind === "managed" && row.shipped ? null : (
                <div className="flex flex-none items-center gap-2 border-t border-border px-4 py-3">
                    <SkillRailFooter
                        model={model}
                        row={row}
                        path={path}
                        ed={ed}
                        onSaved={(t) => setFile(fileTextOf(t))}
                    />
                </div>
            )}
        </motion.aside>
    );
}

// The New skill form, in the rail's place: a name and the description an agent reads to decide when to use it.
// Create writes the vault skill, copies it into every harness and opens it in the editor.
function NewSkillRail({ taken }: { taken: string[] }) {
    const form = useAtomValue(setupNewSkillAtom);
    const busy = useAtomValue(setupBusyAtom);
    if (form == null) {
        return null;
    }
    const name = form.name.trim();
    const nameError = skillNameError(name, taken);
    const ready = name !== "" && nameError == null && form.description.trim() !== "" && !busy;
    return (
        <motion.aside
            {...FADE_IN}
            aria-label="New skill"
            data-new-skill-form
            className="flex w-[440px] flex-none flex-col border-l border-border bg-surface"
        >
            <form
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (ready) {
                        fireAndForget(createSkill);
                    }
                }}
            >
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                    <div className="flex flex-col gap-1">
                        <div className="text-[14px] font-medium text-primary">New skill</div>
                        <div className="text-[12.5px] leading-[1.5] text-muted">
                            Made in the vault on this machine and copied into each harness's skills folder.
                        </div>
                    </div>
                    <label className="flex flex-col gap-1.5">
                        <span className={SECTION_HEAD}>Name</span>
                        <input
                            data-new-skill-name
                            autoFocus
                            value={form.name}
                            maxLength={MAX_SKILL_NAME + 8}
                            spellCheck={false}
                            placeholder="trade-check"
                            onChange={(e) => typeNewSkill({ ...form, name: e.target.value })}
                            className={cn(INPUT, "font-mono text-[12.5px]")}
                        />
                        <span
                            data-new-skill-name-error
                            className={cn("text-[11.5px]", nameError != null ? "text-warning-soft" : "text-muted")}
                        >
                            {nameError ?? "The folder name, and how you call it: /trade-check."}
                        </span>
                    </label>
                    <label className="flex flex-col gap-1.5">
                        <span className={SECTION_HEAD}>Description</span>
                        <textarea
                            data-new-skill-description
                            value={form.description}
                            rows={4}
                            placeholder="Use when … (an agent reads this to decide when to use the skill)"
                            onChange={(e) => typeNewSkill({ ...form, description: e.target.value })}
                            className={cn(INPUT, "h-auto resize-none py-2 leading-[1.5]")}
                        />
                    </label>
                </div>
                <div className="flex flex-none items-center gap-2 border-t border-border px-4 py-3">
                    <button type="button" disabled={busy} onClick={closeNewSkill} className={BTN_SECONDARY}>
                        Cancel
                    </button>
                    <span className="flex-1" />
                    <button type="submit" data-new-skill-create disabled={!ready} className={BTN_PRIMARY}>
                        {busy ? "Creating…" : "Create and edit"}
                    </button>
                </div>
            </form>
        </motion.aside>
    );
}

function SkillsTab({ model }: { model: AgentsViewModel }) {
    const { data, groups } = useSkillGroups();
    const selectedName = useAtomValue(setupSkillSelectedAtom);
    const newSkill = useAtomValue(setupNewSkillAtom);
    const error = useAtomValue(setupErrorAtom);
    // re-read on every visit: an agent may have written a skill since
    useEffect(() => {
        fireAndForget(loadSkills);
    }, []);
    const rows = groups.flatMap((g) => g.rows);
    const selected = rows.find((r) => r.name === selectedName) ?? rows[0] ?? null;
    return (
        <div className="flex min-w-0 flex-1 flex-col">
            <ErrorBanner error={error} />
            <div className="flex min-h-0 flex-1">
                {data == null ? (
                    <div className="flex flex-1 items-center justify-center text-[13px] text-muted">Reading…</div>
                ) : (
                    <>
                        <div className="flex min-w-0 flex-1 flex-col px-5 pb-4 pt-3.5">
                            <SkillsMatrix
                                columns={data.columns ?? []}
                                groups={groups}
                                selected={newSkill != null ? null : (selected?.name ?? null)}
                            />
                        </div>
                        {newSkill != null ? (
                            <NewSkillRail taken={rows.map((r) => r.name)} />
                        ) : selected != null ? (
                            <SkillRail
                                model={model}
                                row={selected}
                                skillsroot={data.skillsroot}
                                columns={data.columns ?? []}
                            />
                        ) : null}
                    </>
                )}
            </div>
        </div>
    );
}

export function SetupSurface({ model }: { model: AgentsViewModel }) {
    const tab = useAtomValue(setupTabAtom);
    // re-read on every visit: a harness file edited outside arcterm must not show stale
    useEffect(() => {
        fireAndForget(loadSetup);
    }, []);
    return (
        <MotionConfig reducedMotion="user">
            <div className="flex h-full min-h-0 flex-col bg-background">
                <div className="flex h-[52px] flex-none items-center gap-5 border-b border-border px-5">
                    <div className="text-[15px] font-semibold text-primary">Setup</div>
                    <Tabs />
                    <div className="flex-1" />
                    {tab === "instructions" ? <HeaderStatus /> : tab === "skills" ? <SkillsHeader /> : <ToolsHeader />}
                </div>
                <motion.div
                    key={tab}
                    {...FADE_IN}
                    id="setup-tabpanel"
                    role="tabpanel"
                    aria-labelledby={`setup-tab-${tab}`}
                    className="flex min-h-0 flex-1"
                >
                    {tab === "instructions" ? (
                        <InstructionsTab />
                    ) : tab === "skills" ? (
                        <SkillsTab model={model} />
                    ) : (
                        <ToolsLibrary model={model} />
                    )}
                </motion.div>
            </div>
        </MotionConfig>
    );
}
