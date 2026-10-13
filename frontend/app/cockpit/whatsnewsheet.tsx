// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The release notes, opened from the footer's version. Each release lists what it added and changed, with its fixes
// folded under a count; an entry that names a binding gets a Try button that takes you to it.

import { ModalShell } from "@/app/modals/modalshell";
import { displayKeys } from "@/app/store/keybindings/matcher";
import { bindingsAtom } from "@/app/store/keybindings/store";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowRight, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { versionInfoAtom } from "./versioninfo";
import {
    entryLead,
    formatReleaseDate,
    inlineSpans,
    releasesToShow,
    type Entry,
    type Release,
    type Section,
    type ShownRelease,
} from "./whatsnew";
import { closeWhatsNew, loadReleases, runTry, seedWhatsNewSeen, tryBinding, whatsNewSinceAtom } from "./whatsnewstore";

export function WhatsNewSheet({ model }: { model: AgentsViewModel }) {
    const since = useAtomValue(whatsNewSinceAtom);
    const current = useAtomValue(versionInfoAtom).app;
    const open = since != null;
    const [releases, setReleases] = useState<Release[] | null>(null);

    // the version is read at boot, after the first render; a first launch starts at it (whatsnewstore.ts)
    useEffect(seedWhatsNewSeen, [current]);

    useEffect(() => {
        if (open && releases == null) {
            loadReleases().then(setReleases, () => setReleases([]));
        }
    }, [open, releases]);

    const shown = releases == null || since == null ? null : releasesToShow(releases, current, since);
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

function ReleaseNotes({ release, model }: { release: ShownRelease; model: AgentsViewModel }) {
    return (
        <section data-release={release.version} className="border-b border-border pt-4 pb-3 last:border-b-0">
            <div className="mb-1 flex items-baseline gap-2">
                <span className="text-[13.5px] font-semibold tabular-nums text-primary">{release.version}</span>
                <span className="text-[12px] tabular-nums text-muted">{formatReleaseDate(release.date)}</span>
                {release.unseen ? (
                    <span className="rounded-full bg-accent/15 px-1.5 py-px text-[10.5px] font-semibold text-accent">
                        New
                    </span>
                ) : null}
            </div>
            {release.sections.map((s) =>
                s.kind === "Fixed" ? (
                    <FixedNotes key={s.kind} section={s} model={model} />
                ) : (
                    <div key={s.kind} className="mt-2">
                        <div className={cn(REGION_LABEL, "mb-0.5 text-muted")}>{s.kind}</div>
                        <EntryList entries={s.entries} model={model} />
                    </div>
                )
            )}
        </section>
    );
}

// fixes are many and mostly read once something broke, so they wait under their count
function FixedNotes({ section, model }: { section: Section; model: AgentsViewModel }) {
    const [open, setOpen] = useState(false);
    const n = section.entries.length;
    return (
        <div className="mt-2">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="flex cursor-pointer items-center gap-1 text-[12px] text-muted hover:text-primary"
            >
                <ChevronRight size={13} className={cn("transition-transform", open && "rotate-90")} aria-hidden />
                {n === 1 ? "1 fix" : `${n} fixes`}
            </button>
            {open ? <EntryList entries={section.entries} model={model} /> : null}
        </div>
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
// whole note.
function EntryRow({ entry, model }: { entry: Entry; model: AgentsViewModel }) {
    const bindings = useAtomValue(bindingsAtom);
    const surface = useAtomValue(model.surfaceAtom);
    const [open, setOpen] = useState(false);
    const binding = entry.tryId ? tryBinding(bindings, entry.tryId, surface) : null;
    const lead = entryLead(entry.text);
    return (
        <li className="flex items-start gap-3">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="group flex min-w-0 flex-1 cursor-pointer items-start gap-1.5 rounded-[6px] py-1.5 text-left"
            >
                <ChevronRight
                    size={13}
                    aria-hidden
                    className={cn(
                        "mt-[4px] shrink-0 text-muted transition-transform group-hover:text-primary",
                        open && "rotate-90"
                    )}
                />
                <span
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
            {binding != null ? (
                <button
                    type="button"
                    data-whats-new-try={entry.tryId}
                    title={
                        binding.keys
                            ? `${binding.label} (${formatChordString(displayKeys(binding.keys))})`
                            : binding.label
                    }
                    onClick={() => runTry(entry.tryId!, surface)}
                    className="mt-[3px] flex h-[24px] shrink-0 cursor-pointer items-center gap-1 rounded-[6px] border border-edge-mid bg-surface-raised px-2 text-[12px] font-medium text-secondary hover:border-edge-strong hover:bg-surface-hover hover:text-primary"
                >
                    Try it
                    <ArrowRight size={12} aria-hidden />
                </button>
            ) : null}
        </li>
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
