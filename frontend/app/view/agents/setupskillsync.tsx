// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Skills tab's additions from the kaeltran16 fork (its feb98d599, 27d06199b and c3a8bf971), kept out of
// setupsurface.tsx: the header's Pi line, a link row's detail, a vault skill's own copies beside the vault copy with
// the choice to replace them, and the choice to leave an unmanaged skill where it is. setupsurface.tsx hooks them
// into the rail; the matrix and its editor are untouched. The logic is in skillsmatrix.ts, the keep map in setupstore.ts.

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { PathTail } from "./pathtail";
import { TONE_TEXT } from "./setupinstructionsync";
import { setSkillKeep, setupSkillKeepAtom, setupStatusAtom } from "./setupstore";
import { SECTION_HEAD } from "./setupstyles";
import { copyDelta, KEEP_LEAVE, KEEP_VAULT, piSkillsLine, type SkillRow } from "./skillsmatrix";

// beside the Skills header's summary: how pi reaches the synced skills, in the tone the backend gave it
export function PiSkillsLine() {
    const line = piSkillsLine(useAtomValue(setupStatusAtom));
    if (line == null) {
        return null;
    }
    return (
        <span data-pi-skills-line data-tone={line.tone} className={cn("text-[12px]", TONE_TEXT[line.tone])}>
            {line.text}
        </span>
    );
}

const CARD = "flex flex-col gap-[5px] rounded border border-border px-2.5 py-[9px]";

// One radio of a two-way choice in the rail. A null value is the default: no entry in the keep map.
function Radio({
    row,
    value,
    chosen,
    title,
    hint,
}: {
    row: SkillRow;
    value: string | null;
    chosen: string | null;
    title: string;
    hint: string;
}) {
    return (
        <label
            className={cn(
                "flex cursor-pointer items-start gap-2 rounded px-2.5 py-2 text-[12.5px] text-secondary",
                chosen === value ? "bg-surface-selected ring-1 ring-edge-strong ring-inset" : "hover:bg-surface-hover"
            )}
        >
            <input
                type="radio"
                name={`skill-sync-${row.name}`}
                checked={chosen === value}
                onChange={() => setSkillKeep(row.name, value)}
                className="mt-0.5 accent-accent"
            />
            <span className="flex flex-col gap-0.5">
                <span className="font-semibold">{title}</span>
                <span className="text-[11.5px] text-muted">{hint}</span>
            </span>
        </label>
    );
}

// An unmanaged skill that needs no keep: Manage moves it into the vault unless it is left where it is. A skill
// whose copies differ keeps its own KeepChoice, which already offers leaving them alone.
export function LeaveChoice({ row }: { row: SkillRow }) {
    const keep = useAtomValue(setupSkillKeepAtom);
    if (row.kind === "managed" || row.kind === "linked" || row.needsKeep) {
        return null;
    }
    const chosen = keep[row.name] === KEEP_LEAVE ? KEEP_LEAVE : null;
    return (
        <fieldset data-skill-leave className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className={cn(SECTION_HEAD, "pb-1.5")}>When arcterm manages it</legend>
            <Radio
                row={row}
                value={null}
                chosen={chosen}
                title="Move it into the vault"
                hint="One copy in the vault, written into each harness that is set up."
            />
            <Radio
                row={row}
                value={KEEP_LEAVE}
                chosen={chosen}
                title="Leave it where it is"
                hint="arcterm skips this skill; each harness keeps its own file."
            />
        </fieldset>
    );
}

// A vault skill a harness also holds its own copy of: the vault card, each copy with how it differs, and the choice
// to replace the copies with the vault's. It counts toward Manage only once Replace is chosen.
export function StrayChoice({ row }: { row: SkillRow }) {
    const keep = useAtomValue(setupSkillKeepAtom);
    if (row.kind !== "managed" || row.strays.length === 0) {
        return null;
    }
    const chosen = keep[row.name] === KEEP_VAULT ? KEEP_VAULT : null;
    return (
        <div data-skill-stray className="flex flex-col gap-2">
            <div className={SECTION_HEAD}>Own copy beside the vault</div>
            {row.strays.map((c) => (
                <div key={c.runtime} data-skill-stray-copy={c.runtime} className={CARD}>
                    <span className="flex items-center gap-2 text-[12.5px] font-semibold text-secondary">
                        {c.label}
                        <span className="ml-auto text-[11px] font-normal text-muted">{copyDelta(c)}</span>
                    </span>
                    <PathTail path={c.path} />
                </div>
            ))}
            <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
                <Radio
                    row={row}
                    value={null}
                    chosen={chosen}
                    title="Leave the own copy"
                    hint="arcterm leaves it alone: the harness keeps reading its own file."
                />
                <Radio
                    row={row}
                    value={KEEP_VAULT}
                    chosen={chosen}
                    title="Replace it with the vault copy"
                    hint="The own copy is set aside under skills-replaced, then the vault copy is written."
                />
            </fieldset>
        </div>
    );
}

// Where a linked skill lives: each link and the folder it points at. arcterm never moves one or writes through it.
export function LinkedLinks({ row }: { row: SkillRow }) {
    return (
        <>
            {row.links.map((l) => (
                <div key={l.runtime} data-skill-link={l.runtime} className={CARD}>
                    <span className="text-[12.5px] font-semibold text-secondary">{l.label}</span>
                    <PathTail path={l.path} />
                    <span title={l.target} className="truncate text-[10.5px] text-muted">
                        Points at {l.target}
                    </span>
                </div>
            ))}
        </>
    );
}
