// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Ideas section of an agent session: what was decided, floated and left open in a brainstorm, from the agent's
// `wsh idea add` and the user's own hand. Rows group as Decided / Ideas / Open, newest first; hovering one offers Edit,
// Mark as decided and Drop, and its checkbox picks rows to Merge or Drop together; Dropped folds at the end with Restore;
// Add an idea takes a line of the user's own. The rail draws the header row (IdeasHeaderExtra adds "N new" and Mark
// read to it); the section marks the list read when it goes away (closed, another tab, another agent).
// Every control carries a data-ideas-* attribute for the CDP scenario `ideas-rail`.

import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import {
    Check,
    ChevronRight,
    CircleCheck,
    CircleHelp,
    Lightbulb,
    Pencil,
    Plus,
    X,
    type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { inputRequestLive } from "./ideacapture";
import {
    canMarkDecided,
    canMerge,
    groupIdeas,
    IDEA_GROUPS,
    ideaCounts,
    ideaKindOf,
    ideaMeta,
    ideaSections,
    isFresh,
    planEdit,
    pruneChecked,
    selectionLabel,
    toggleChecked,
    type IdeaKind,
} from "./ideasmodel";
import { addIdea, ideasAtom, ideasInputRequestAtom, markIdeasRead, updateIdeas, useSessionIdeas } from "./ideasstore";

const KIND_ICON: Record<IdeaKind, LucideIcon> = {
    decision: CircleCheck,
    idea: Lightbulb,
    question: CircleHelp,
};

const ACTION =
    "flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent text-secondary outline-none hover:bg-surface-selected hover:text-primary focus-visible:ring-2 focus-visible:ring-accent";
const TEXT_BUTTON =
    "cursor-pointer rounded-[5px] border-0 bg-transparent px-[4px] py-[2px] text-[11px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent";

// "N new" and Mark read, at the end of the section's header row while any idea is new (the rail keeps the list loaded)
export function IdeasHeaderExtra({ sessionId }: { sessionId: string }) {
    const { fresh } = ideaCounts(useAtomValue(ideasAtom(sessionId)));
    if (fresh === 0) {
        return null;
    }
    return (
        <>
            <span data-ideas-newcount className="text-[11px] tabular-nums text-secondary">
                {fresh} new
            </span>
            <button
                type="button"
                data-ideas-markread
                onClick={() => void markIdeasRead(sessionId)}
                className={TEXT_BUTTON}
            >
                Mark read
            </button>
        </>
    );
}

function Checkbox({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            aria-label={label}
            data-ideas-check
            onClick={onToggle}
            className={cn(
                "flex h-[13px] w-[13px] cursor-pointer items-center justify-center rounded-[3px] p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent",
                checked ? "border-0 bg-primary text-background" : "border border-edge-strong bg-transparent"
            )}
        >
            {checked ? <Check size={10} strokeWidth={3} aria-hidden /> : null}
        </button>
    );
}

function IdeaRow({
    idea,
    withTopic,
    fresh,
    checked,
    selecting,
    onToggle,
    onEdit,
    onDecide,
    onDrop,
}: {
    idea: Idea;
    withTopic: boolean; // the list is laid out by topic and this row sits outside its topic's section
    fresh: boolean;
    checked: boolean;
    selecting: boolean; // some row is checked: every row offers its checkbox in place of its icon
    onToggle: () => void;
    onEdit: () => void;
    onDecide: () => void;
    onDrop: () => void;
}) {
    const Icon = KIND_ICON[ideaKindOf(idea)];
    const onHover = "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";
    return (
        <div
            data-ideas-row={idea.id}
            data-kind={ideaKindOf(idea)}
            data-fresh={fresh ? "true" : "false"}
            className={cn(
                "group relative flex items-start gap-[8px] rounded-[6px] py-[5px] pl-[8px] pr-[6px]",
                checked ? "bg-surface-selected" : "hover:bg-surface-hover focus-within:bg-surface-hover"
            )}
        >
            <span className="relative mt-[2px] h-[13px] w-[13px] flex-none">
                <Icon
                    size={12}
                    strokeWidth={1.8}
                    aria-hidden
                    className={cn(
                        "absolute left-0 top-px text-muted",
                        selecting ? "opacity-0" : "group-hover:opacity-0 group-focus-within:opacity-0"
                    )}
                />
                <span
                    className={cn(
                        "absolute inset-0 flex items-center justify-center",
                        selecting ? "opacity-100" : onHover
                    )}
                >
                    <Checkbox checked={checked} label={`Select: ${idea.text}`} onToggle={onToggle} />
                </span>
            </span>
            <div className="min-w-0 flex-1">
                <div
                    data-ideas-text
                    className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.45] text-ink-hi"
                >
                    {idea.text}
                </div>
                <div className="mt-px flex items-center gap-[6px] text-[10.5px] tabular-nums text-muted">
                    <span data-ideas-meta>{ideaMeta(idea, withTopic)}</span>
                    {fresh ? (
                        <span
                            data-ideas-newpill
                            className="rounded-full bg-primary/5 px-[5px] font-medium text-secondary"
                        >
                            New
                        </span>
                    ) : null}
                </div>
            </div>
            {/* over the row's bottom right, on the meta line, so a hidden set of actions takes no width from the text
                and a shown one covers none of it */}
            <div
                className={cn(
                    "absolute bottom-[2px] right-[6px] flex gap-px rounded-[6px]",
                    checked ? "bg-surface-selected" : "bg-surface-hover",
                    onHover
                )}
            >
                <button
                    type="button"
                    data-ideas-action="edit"
                    aria-label="Edit"
                    title="Edit"
                    onClick={onEdit}
                    className={ACTION}
                >
                    <Pencil size={12} strokeWidth={1.8} aria-hidden />
                </button>
                {canMarkDecided(idea) ? (
                    <button
                        type="button"
                        data-ideas-action="decide"
                        aria-label="Mark as decided"
                        title="Mark as decided"
                        onClick={onDecide}
                        className={ACTION}
                    >
                        <CircleCheck size={12} strokeWidth={1.8} aria-hidden />
                    </button>
                ) : null}
                <button
                    type="button"
                    data-ideas-action="drop"
                    aria-label="Drop"
                    title="Drop"
                    onClick={onDrop}
                    className={ACTION}
                >
                    <X size={12} strokeWidth={1.8} aria-hidden />
                </button>
            </div>
        </div>
    );
}

// the row being edited: its text, its kind as a three-way choice, Cancel and Save
function IdeaEditor({
    idea,
    onSave,
    onCancel,
}: {
    idea: Idea;
    onSave: (changes: { text?: string; kind?: IdeaKind }) => Promise<boolean>;
    onCancel: () => void;
}) {
    const [text, setText] = useState(idea.text);
    const [kind, setKind] = useState<IdeaKind>(ideaKindOf(idea));
    const [saving, setSaving] = useState(false);
    const box = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        box.current?.focus();
        box.current?.setSelectionRange(box.current.value.length, box.current.value.length);
    }, []);
    const plan = planEdit(idea, { text, kind });
    const save = async () => {
        if (plan == null || saving) {
            return;
        }
        setSaving(true);
        const ok = await onSave(plan);
        if (!ok) {
            setSaving(false);
        }
    };
    const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
        } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.stopPropagation();
            void save();
        }
    };
    return (
        <div
            data-ideas-editor={idea.id}
            onKeyDown={onKeyDown}
            className="flex flex-col gap-[6px] rounded-[6px] bg-surface-raised px-[8px] py-[6px]"
        >
            <label htmlFor={`idea-edit-${idea.id}`} className="sr-only">
                Edit idea
            </label>
            <textarea
                id={`idea-edit-${idea.id}`}
                ref={box}
                data-ideas-editbox
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full resize-none rounded-[6px] border border-accent bg-surface px-[8px] py-[6px] text-[12.5px] leading-[1.45] text-primary outline-none"
            />
            <div className="flex items-center gap-[6px]">
                <div role="radiogroup" aria-label="Kind" className="flex gap-[2px] rounded-[6px] bg-surface p-[2px]">
                    {IDEA_GROUPS.map((g) => (
                        <button
                            key={g.kind}
                            type="button"
                            role="radio"
                            aria-checked={kind === g.kind}
                            data-ideas-kind={g.kind}
                            onClick={() => setKind(g.kind)}
                            className={cn(
                                "h-[22px] cursor-pointer rounded-[5px] border-0 px-[7px] text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                kind === g.kind
                                    ? "bg-surface-selected text-primary"
                                    : "bg-transparent text-muted hover:text-secondary"
                            )}
                        >
                            {g.choiceLabel}
                        </button>
                    ))}
                </div>
                <span className="flex-1" />
                <button
                    type="button"
                    data-ideas-cancel
                    onClick={onCancel}
                    className="h-[24px] cursor-pointer rounded-[6px] border-0 bg-transparent px-[8px] text-[11.5px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    data-ideas-save
                    title="Save (Ctrl Enter)"
                    disabled={plan == null || saving}
                    onClick={() => void save()}
                    className="h-[24px] cursor-pointer rounded-[6px] border border-edge-mid bg-surface-hover px-[9px] text-[11.5px] text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:text-ink-faint"
                >
                    Save
                </button>
            </div>
        </div>
    );
}

// the bar over the rows while any is checked: Merge and Drop apply to the checked ones, Esc or the X clears
function SelectionBar({
    n,
    mergeable,
    onMerge,
    onDrop,
    onClear,
}: {
    n: number;
    mergeable: boolean;
    onMerge: () => void;
    onDrop: () => void;
    onClear: () => void;
}) {
    return (
        <div
            data-ideas-selbar
            className="mx-[8px] mb-[4px] mt-[2px] flex items-center gap-[6px] rounded-[6px] bg-surface-raised py-[5px] pl-[10px] pr-[6px]"
        >
            <span className="flex-1 text-[12px] font-medium tabular-nums text-primary">{selectionLabel(n)}</span>
            <button
                type="button"
                data-ideas-merge
                disabled={!mergeable}
                title={mergeable ? "Merge into one idea" : "Select two or more ideas to merge"}
                onClick={onMerge}
                className="h-[24px] cursor-pointer rounded-[6px] border-0 bg-accent px-[9px] text-[11.5px] font-medium text-background outline-none hover:bg-accenthover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-accent"
            >
                Merge
            </button>
            <button
                type="button"
                data-ideas-selection-drop
                onClick={onDrop}
                className="h-[24px] cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-[9px] text-[11.5px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
            >
                Drop
            </button>
            <button
                type="button"
                data-ideas-clear
                aria-label="Clear selection"
                title="Clear selection (Esc)"
                onClick={onClear}
                className="flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
            >
                <X size={13} strokeWidth={1.8} aria-hidden />
            </button>
        </div>
    );
}

function AddIdea({ sessionId }: { sessionId: string }) {
    const [value, setValue] = useState("");
    const adding = useRef(false);
    const input = useRef<HTMLInputElement>(null);
    const request = useAtomValue(ideasInputRequestAtom);
    // the shortcut pressed with nothing selected asks for this box (ideasInputRequestAtom); answering clears the request
    useEffect(() => {
        if (inputRequestLive(request, sessionId, Date.now())) {
            input.current?.focus();
            globalStore.set(ideasInputRequestAtom, null);
        }
    }, [request, sessionId]);
    const submit = async () => {
        const text = value.trim();
        if (text === "" || adding.current) {
            return;
        }
        adding.current = true;
        const added = await addIdea(sessionId, text, "you");
        adding.current = false;
        if (added != null) {
            setValue("");
        }
    };
    return (
        <div className="mx-[8px] mt-[6px]">
            <label htmlFor={`idea-add-${sessionId}`} className="sr-only">
                Add an idea
            </label>
            <div className="flex h-[30px] items-center gap-[8px] rounded-[6px] border border-edge-mid bg-surface px-[8px] focus-within:border-edge-strong">
                <Plus size={12} strokeWidth={1.8} aria-hidden className="flex-none text-muted" />
                <input
                    ref={input}
                    id={`idea-add-${sessionId}`}
                    data-ideas-add
                    value={value}
                    placeholder="Add an idea"
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        // an IME's Enter commits its composition, it does not add the line
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            void submit();
                        }
                    }}
                    className="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-primary outline-none placeholder:text-ink-faint"
                />
            </div>
        </div>
    );
}

// IdeasSection lists a session's ideas, which its caller keeps loaded (useSessionIdeas). `quiet` (an ended session's view) draws no New pills and does not mark the
// list read when it goes: only the rail, where the user watches a live brainstorm, keeps that.
export function IdeasSection({ sessionId, quiet }: { sessionId: string; quiet?: boolean }) {
    const ideas = useAtomValue(ideasAtom(sessionId));
    const groups = groupIdeas(ideas);
    const { fresh } = ideaCounts(ideas);
    const seenAt = ideas?.seenat ?? 0;
    const [checked, setChecked] = useState<string[]>([]);
    const [editing, setEditing] = useState<string | null>(null);
    const [droppedOpen, setDroppedOpen] = useState(false);

    // a checked idea that was dropped, merged away or deleted by an agent is no longer picked
    useEffect(() => {
        setChecked((prev) => pruneChecked(prev, ideas));
        setEditing((prev) => (prev != null && ideas?.ideas.some((i) => i.id === prev && !i.dropped) ? prev : null));
    }, [ideas]);

    // leaving the section (closed, another tab, another agent) is the user having seen what it showed. The count it
    // saw is read from the commit before the cleanup runs, so a change of session reads the old session's.
    const freshRef = useRef(0);
    useEffect(() => {
        freshRef.current = quiet ? 0 : fresh;
    });
    useEffect(
        () => () => {
            if (freshRef.current > 0) {
                void markIdeasRead(sessionId);
            }
        },
        [sessionId]
    );

    const clear = () => setChecked([]);
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape" && checked.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            clear();
        }
    };
    const row = (idea: Idea, withTopic: boolean) =>
        editing === idea.id ? (
            <IdeaEditor
                key={idea.id}
                idea={idea}
                onCancel={() => setEditing(null)}
                onSave={async (changes) => {
                    if (
                        changes.text != null &&
                        !(await updateIdeas(sessionId, { op: "edit", ids: [idea.id], text: changes.text }))
                    ) {
                        return false;
                    }
                    if (
                        changes.kind != null &&
                        !(await updateIdeas(sessionId, { op: "kind", ids: [idea.id], newkind: changes.kind }))
                    ) {
                        return false;
                    }
                    setEditing(null);
                    return true;
                }}
            />
        ) : (
            <IdeaRow
                key={idea.id}
                idea={idea}
                withTopic={withTopic}
                fresh={!quiet && isFresh(idea, seenAt)}
                checked={checked.includes(idea.id)}
                selecting={checked.length > 0}
                onToggle={() => setChecked((prev) => toggleChecked(prev, idea.id))}
                onEdit={() => setEditing(idea.id)}
                onDecide={() => void updateIdeas(sessionId, { op: "kind", ids: [idea.id], newkind: "decision" })}
                onDrop={() => void updateIdeas(sessionId, { op: "drop", ids: [idea.id] })}
            />
        );
    return (
        <div data-ideas-section data-owns-keys onKeyDown={onKeyDown} className="-mx-[8px] flex flex-col gap-px">
            {checked.length > 0 ? (
                <SelectionBar
                    n={checked.length}
                    mergeable={canMerge(checked)}
                    onMerge={() => {
                        void updateIdeas(sessionId, { op: "merge", ids: checked });
                        clear();
                    }}
                    onDrop={() => {
                        void updateIdeas(sessionId, { op: "drop", ids: checked });
                        clear();
                    }}
                    onClear={clear}
                />
            ) : null}
            {ideaSections(groups).map((sec) => (
                <div
                    key={sec.key === "topic" ? `topic:${sec.label}` : sec.key}
                    data-ideas-group={sec.key}
                    data-topic={sec.key === "topic" ? sec.label : undefined}
                    data-count={sec.items.length}
                    className="flex flex-col gap-px"
                >
                    <div className="flex min-w-0 items-center gap-[6px] pb-[2px] pl-[29px] pr-[8px] pt-[6px]">
                        <span className="truncate text-[11px] font-medium text-muted">{sec.label}</span>
                        <span className="flex-none text-[10.5px] tabular-nums text-ink-faint">{sec.items.length}</span>
                    </div>
                    {sec.items.map((idea) => row(idea, sec.topical && sec.key === "question"))}
                </div>
            ))}
            {groups.dropped.length > 0 ? (
                <div data-ideas-group="dropped" data-count={groups.dropped.length} className="flex flex-col gap-px">
                    <button
                        type="button"
                        data-ideas-dropped
                        aria-expanded={droppedOpen}
                        onClick={() => setDroppedOpen((v) => !v)}
                        className="flex w-full cursor-pointer items-center gap-[6px] rounded-[6px] border-0 bg-transparent pb-[2px] pl-[8px] pr-[8px] pt-[8px] text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <ChevronRight
                            size={11}
                            strokeWidth={2}
                            aria-hidden
                            className={cn("flex-none text-ink-faint transition-transform", droppedOpen && "rotate-90")}
                        />
                        <span className="text-[11px] font-medium text-muted">Dropped</span>
                        <span className="text-[10.5px] tabular-nums text-ink-faint">{groups.dropped.length}</span>
                    </button>
                    {droppedOpen
                        ? groups.dropped.map((idea) => (
                              <div
                                  key={idea.id}
                                  data-ideas-row={idea.id}
                                  data-dropped="true"
                                  className="flex items-start gap-[8px] rounded-[6px] py-[5px] pl-[29px] pr-[6px]"
                              >
                                  <div className="min-w-0 flex-1">
                                      <div
                                          data-ideas-text
                                          className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.45] text-muted line-through"
                                      >
                                          {idea.text}
                                      </div>
                                      <div data-ideas-meta className="mt-px text-[10.5px] tabular-nums text-muted">
                                          {ideaMeta(idea)}
                                      </div>
                                  </div>
                                  <button
                                      type="button"
                                      data-ideas-action="restore"
                                      onClick={() => void updateIdeas(sessionId, { op: "restore", ids: [idea.id] })}
                                      className={TEXT_BUTTON}
                                  >
                                      Restore
                                  </button>
                              </div>
                          ))
                        : null}
                </div>
            ) : null}
            <AddIdea sessionId={sessionId} />
        </div>
    );
}

// EndedSessionIdeas is the Ideas of a session that is over (Conversation History, an ended session's transcript): one
// folded line, "Ideas · N", that opens the list in place. Nothing at all for a session that has none. It reads the
// list quietly: looking at it here does not mark anything read.
export function EndedSessionIdeas({ sessionId }: { sessionId: string }) {
    const { live } = ideaCounts(useSessionIdeas(sessionId));
    const [open, setOpen] = useState(false);
    if (live === 0) {
        return null;
    }
    return (
        <div data-ideas-ended className="flex-none border-b border-edge-faint pb-1">
            <button
                type="button"
                data-ideas-ended-toggle
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="flex cursor-pointer items-center gap-[6px] rounded-[6px] border-0 bg-transparent px-[2px] py-[3px] text-[12px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
            >
                <ChevronRight
                    size={12}
                    aria-hidden
                    className={cn("flex-none text-ink-faint transition-transform", open && "rotate-90")}
                />
                <Lightbulb size={12} strokeWidth={1.8} aria-hidden className="flex-none" />
                <span className="tabular-nums">Ideas · {live}</span>
            </button>
            {open ? (
                // the section pulls itself 8px out on each side (-mx-[8px]) to use the rail body's padding: this box has to
                // give it that padding, or its right edge overflows and scrolls sideways
                <div data-ideas-ended-body className="max-h-[40vh] max-w-[560px] overflow-y-auto px-[8px] pt-[4px]">
                    <IdeasSection sessionId={sessionId} quiet />
                </div>
            ) : null}
        </div>
    );
}
