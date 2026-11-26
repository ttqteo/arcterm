// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The words and the started state of Sprout's ideas line (petideas.tsx, docs/superpowers/specs/2026-11-26-session-ideas-design.md,
// "Jarvis"): the line's count, where an idea would go, when its transcript is deleted, and which chip already opened an agent.
// Pure; the chips and the rows are sessionideasmodel.ts's, so the popup and the Brief never disagree about either.

import { LEAVING_SOON_DAYS, type IdeaChip } from "./sessionideasmodel";

const DAY_MS = 86_400_000;

/** The line above the chips: how many ideas wait for a decision. */
export function ideasLine(n: number): string {
    return `${n} idea${n === 1 ? "" : "s"} from your sessions to review`;
}

/** Where an idea would go: its initiative, or a new idea in its project. */
export function ideaWhere(idea: SessionIdea): string {
    return idea.efforttitle || `New idea · ${idea.project}`;
}

/** The warning a row carries while its transcript is deleted within LEAVING_SOON_DAYS, else null. One already past its day
 *  says its source may be gone, since the cleanup takes it any time from then. */
export function ideaLeavesLabel(idea: SessionIdea, now: number): string | null {
    if (idea.deletests <= 0 || idea.deletests > now + LEAVING_SOON_DAYS * DAY_MS) {
        return null;
    }
    if (idea.deletests <= now) {
        return "transcript may already be gone";
    }
    const day = new Date(idea.deletests).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `transcript deleted ${day}`;
}

/** The tab of the agent a chip already opened, while it is open (the popup then shows its started line with Go to agent
 *  instead of opening a second one), else undefined. `tabOf` is launchedFor for one idea. Discuss is its own idea's agent.
 *  Go through is one agent holding every idea waiting, so it counts only while all of them share a tab: an idea that came in
 *  since, or one a Discuss took, makes the chip a new pass. `kindOf` says what opened a tab: a Go through holding the idea is
 *  not its Discuss (the spec puts a Discuss in the idea's project, apart from Go through's No folder), so the chip opens one. */
export function ideaChipTab(
    chip: IdeaChip,
    rows: readonly SessionIdea[],
    tabOf: (ideaId: string) => string | undefined,
    kindOf: (tab: string) => "discuss" | "go-through" | undefined
): string | undefined {
    if (chip.kind === "discuss") {
        const tab = chip.ideaId !== undefined ? tabOf(chip.ideaId) : undefined;
        return tab !== undefined && kindOf(tab) === "discuss" ? tab : undefined;
    }
    if (chip.kind !== "go-through") {
        return undefined;
    }
    const tabs = rows.map((r) => tabOf(r.id));
    const first = tabs[0];
    return first !== undefined && tabs.every((t) => t === first) ? first : undefined;
}

/** The started line of a chip whose agent is open: a title that may be cut at the panel's edge, and a detail that stays. */
export function startedLine(chip: IdeaChip, rows: readonly SessionIdea[]): { title: string; detail: string } {
    if (chip.kind === "discuss") {
        const idea = rows.find((r) => r.id === chip.ideaId);
        // a Discuss opens in the idea's project, or in No folder when it carries none (sessionideaslaunch.ts)
        const where = idea?.projectpath ? idea.project : "No folder";
        return { title: `Discuss: ${idea?.gist ?? ""}`, detail: `${where} · sonnet · started` };
    }
    return { title: "Session ideas", detail: "No folder · sonnet · started" };
}
