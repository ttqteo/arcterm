// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The release notes, opened from the footer's version. Each release leads with its highlights as cards and folds every
// other note under one count; an entry that names a binding gets a Try button that takes you to it.

import { ModalShell } from "@/app/modals/modalshell";
import { displayKeys } from "@/app/store/keybindings/matcher";
import { bindingsAtom } from "@/app/store/keybindings/store";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowRight, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { versionInfoAtom } from "./versioninfo";
import {
    entryBody,
    entryLead,
    foldLabel,
    formatReleaseDate,
    inlineSpans,
    releasesToShow,
    splitHighlights,
    type Entry,
    type Release,
    type Section,
} from "./whatsnew";
import { closeWhatsNew, loadReleases, runTry, tryBinding, whatsNewOpenAtom } from "./whatsnewstore";

export function WhatsNewSheet({ model }: { model: AgentsViewModel }) {
    const open = useAtomValue(whatsNewOpenAtom);
    const current = useAtomValue(versionInfoAtom).app;
    const [releases, setReleases] = useState<Release[] | null>(null);

    useEffect(() => {
        if (open && releases == null) {
            loadReleases().then(setReleases, () => setReleases([]));
        }
    }, [open, releases]);

    const shown = releases == null ? null : releasesToShow(releases, current);
    return (
        <ModalShell
            open={open}
            onClose={closeWhatsNew}
            className="flex w-[min(640px,93vw)] max-h-[76vh] flex-col"
            topClass="pt-[10vh]"
        >
            {open ? (
                <>
                    <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-[13px]">
                        <span className="text-[14px] font-semibold text-primary">What's new</span>
                        <span className="text-[12.5px] tabular-nums text-muted">in arcterm {current}</span>
                        <span className="ml-auto shrink-0 rounded-[5px] border border-edge-mid px-[7px] py-0.5 font-mono text-[10.5px] text-muted">
                            esc
                        </span>
                    </div>
                    <div data-whats-new className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
                        {shown == null ? (
                            <div className="py-6 text-[13px] text-muted">Loading the notes…</div>
                        ) : shown.length === 0 ? (
                            <div className="py-6 text-[13px] text-muted">No notes for this build.</div>
                        ) : (
                            shown.map((r) => <ReleaseNotes key={r.version} release={r} model={model} />)
                        )}
                    </div>
                </>
            ) : null}
        </ModalShell>
    );
}

// A release leads with its few highlights as cards; every other note, its fixes too, waits under one fold line.
function ReleaseNotes({ release, model }: { release: Release; model: AgentsViewModel }) {
    const { highlights, rest } = splitHighlights(release);
    return (
        <section data-release={release.version} className="border-b border-border pt-4 pb-3 last:border-b-0">
            <div className="mb-1 flex items-baseline gap-2">
                <span className="text-[13.5px] font-semibold tabular-nums text-primary">{release.version}</span>
                <span className="text-[12px] tabular-nums text-muted">{formatReleaseDate(release.date)}</span>
            </div>
            {highlights.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-2">
                    {highlights.map((e, i) => (
                        <HighlightCard key={i} entry={e} model={model} />
                    ))}
                </ul>
            ) : null}
            <MoreNotes sections={rest} afterCards={highlights.length > 0} model={model} />
        </section>
    );
}

function MoreNotes({
    sections,
    afterCards,
    model,
}: {
    sections: Section[];
    afterCards: boolean;
    model: AgentsViewModel;
}) {
    const [open, setOpen] = useState(false);
    const label = foldLabel(sections, afterCards);
    if (label === "") {
        return null;
    }
    return (
        <div className="mt-2.5">
            <button
                type="button"
                data-whats-new-more
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="flex cursor-pointer items-center gap-1 text-[12px] text-muted hover:text-primary"
            >
                <ChevronRight size={13} className={cn("transition-transform", open && "rotate-90")} aria-hidden />
                {label}
            </button>
            {open
                ? sections.map((s) => (
                      <div key={s.kind} className="mt-2">
                          <div className={cn(REGION_LABEL, "mb-0.5 text-muted")}>{s.kind}</div>
                          <EntryList entries={s.entries} model={model} />
                      </div>
                  ))
                : null}
        </div>
    );
}

// A highlight: its bold lead as the title and the rest of the note under it, cut at two lines (a note with no lead, its
// text cut at three). A click opens the whole note, only when it was cut.
function HighlightCard({ entry, model }: { entry: Entry; model: AgentsViewModel }) {
    const [open, setOpen] = useState(false);
    const textRef = useRef<HTMLDivElement>(null);
    const lead = entryLead(entry.text);
    const body = lead != null ? entryBody(entry.text) : entry.text;
    const expandable = useClamped(textRef, !open) || open;
    const tryIt = useTryBinding(entry, model);
    return (
        <li
            data-whats-new-card
            className="flex flex-col gap-2 rounded-md border border-edge-mid bg-surface px-3.5 py-3"
        >
            <button
                type="button"
                aria-expanded={expandable ? open : undefined}
                disabled={!expandable}
                onClick={() => setOpen((v) => !v)}
                className={cn("group flex min-w-0 flex-col gap-1 text-left", expandable && "cursor-pointer")}
            >
                {lead != null ? (
                    <span className="text-[13.5px] leading-[1.45] font-semibold text-primary">{lead}</span>
                ) : null}
                <div
                    ref={textRef}
                    className={cn(
                        "text-[12.5px] leading-[1.55]",
                        lead != null ? "text-secondary" : "text-primary",
                        expandable && "group-hover:text-primary",
                        !open && (lead != null ? "line-clamp-2" : "line-clamp-3")
                    )}
                >
                    <NoteText text={body} />
                </div>
            </button>
            {tryIt != null ? (
                <div className="flex justify-end">
                    <TryButton tryId={entry.tryId!} {...tryIt} />
                </div>
            ) : null}
        </li>
    );
}

function EntryList({ entries, model }: { entries: Entry[]; model: AgentsViewModel }) {
    return (
        <ul className="flex flex-col">
            {entries.map((e, i) => (
                <EntryRow key={i} entry={e} model={model} />
            ))}
        </ul>
    );
}

// Headlines first: an entry shows its bold lead alone (one without a lead, its first two lines), and a click opens the
// whole note. An entry with nothing more to show (no lead, and it fits its two lines) gets no chevron and no click.
function EntryRow({ entry, model }: { entry: Entry; model: AgentsViewModel }) {
    const [open, setOpen] = useState(false);
    const textRef = useRef<HTMLSpanElement>(null);
    const lead = entryLead(entry.text);
    const clamped = useClamped(textRef, lead == null && !open);
    const tryIt = useTryBinding(entry, model);
    const expandable = lead != null || clamped;
    return (
        <li className="flex items-start gap-3">
            <button
                type="button"
                aria-expanded={expandable ? open : undefined}
                disabled={!expandable}
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    "group flex min-w-0 flex-1 items-start gap-1.5 rounded-[6px] py-1.5 text-left",
                    expandable && "cursor-pointer"
                )}
            >
                <ChevronRight
                    size={13}
                    aria-hidden
                    className={cn(
                        "mt-[4px] shrink-0 text-muted transition-transform group-hover:text-primary",
                        open && "rotate-90",
                        !expandable && "invisible"
                    )}
                />
                <span
                    ref={textRef}
                    className={cn(
                        "min-w-0 flex-1 text-[13px] leading-[1.55] text-secondary",
                        !open && lead == null && "line-clamp-2"
                    )}
                >
                    {!open && lead != null ? (
                        <strong className="font-semibold text-primary group-hover:underline">{lead}</strong>
                    ) : (
                        <NoteText text={entry.text} />
                    )}
                </span>
            </button>
            {tryIt != null ? (
                <div className="mt-[3px] shrink-0">
                    <TryButton tryId={entry.tryId!} {...tryIt} />
                </div>
            ) : null}
        </li>
    );
}

// Whether the line-clamped text in `ref` is cut. Measured only while `active` (the clamp on): opened, the text shows in
// full, so the closed measure stands.
function useClamped(ref: RefObject<HTMLElement | null>, active: boolean): boolean {
    const [clamped, setClamped] = useState(false);
    useLayoutEffect(() => {
        const el = ref.current;
        if (el == null || !active) {
            return;
        }
        const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [ref, active]);
    return clamped;
}

function useTryBinding(entry: Entry, model: AgentsViewModel) {
    const bindings = useAtomValue(bindingsAtom);
    const surface = useAtomValue(model.surfaceAtom);
    const binding = entry.tryId ? tryBinding(bindings, entry.tryId, surface) : null;
    return binding == null ? null : { binding, surface };
}

function TryButton({ tryId, binding, surface }: { tryId: string } & NonNullable<ReturnType<typeof useTryBinding>>) {
    return (
        <button
            type="button"
            data-whats-new-try={tryId}
            title={binding.keys ? `${binding.label} (${formatChordString(displayKeys(binding.keys))})` : binding.label}
            onClick={() => runTry(tryId, surface)}
            className="flex h-[24px] cursor-pointer items-center gap-1 rounded-[6px] border border-edge-mid bg-surface-raised px-2 text-[12px] font-medium text-secondary hover:border-edge-strong hover:bg-surface-hover hover:text-primary"
        >
            Try it
            <ArrowRight size={12} aria-hidden />
        </button>
    );
}

function NoteText({ text }: { text: string }) {
    return (
        <>
            {inlineSpans(text).map((s, i) =>
                s.kind === "bold" ? (
                    <strong key={i} className="font-semibold text-primary">
                        {s.text}
                    </strong>
                ) : s.kind === "em" ? (
                    <em key={i}>{s.text}</em>
                ) : s.kind === "code" ? (
                    // the modal sits on surface-raised, so the chip takes the darker surface to read as one
                    <code key={i} className="rounded-[4px] bg-surface px-[3px] font-mono text-[11.5px] text-primary">
                        {s.text}
                    </code>
                ) : (
                    <span key={i}>{s.text}</span>
                )
            )}
        </>
    );
}
