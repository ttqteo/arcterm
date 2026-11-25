// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A pair's words off the Agent surface (Library's Conversations, the Overview's History, the read-only pair view), pure:
// why it stopped, the read view's header, the links to both agents' transcripts, and what a search finds in it. One
// source, so every surface says the same thing. The live pair's own words (the header button, the timeline) are in
// pairmodel.ts.

import { shortTabId } from "./agentrowmodel";
import { formatTokens } from "./agentsviewmodel";
import { messageClock } from "./pairpanemodel";

const STOP_WORDS: Record<string, string> = {
    settled: "both sides settled",
    "token-cap": "token cap reached",
    "no-new-points": "no new points",
    "judges-gone": "judges gone",
};

/** Why a pair is where it is: the reason it stopped when it has one (a pair that stopped and was ended after keeps it),
 *  else its state. A pair read from the synced folder adds that it is as of the last sync. */
export function pairStateWords(info: Pick<PairInfo, "state" | "stopreason" | "synced">): string {
    const words =
        STOP_WORDS[info.stopreason] ??
        (info.state === "relaying" ? "still relaying" : info.state === "stopped" ? "stopped" : "ended");
    return info.synced ? `${words} · as of the last sync` : words;
}

/** "25/11 14:32": the local day and month, then the clock. */
function dayAndClock(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${messageClock(ts)}`;
}

const SINCE: Record<string, string> = { ended: "Ended", stopped: "Stopped", relaying: "Relaying since" };

/** The read-only view's header: the title ("Plan oracle with judge 4c6ba858", "… with 2 judges") and the line under it
 *  (when it ended, stopped or began relaying, which the last save says; why; the tokens spent). */
export function pairReadHeader(view: PairView): { title: string; line: string } {
    const judges = view.judges ?? [];
    const who = judges.length === 1 ? `judge ${shortTabId(judges[0].tab)}` : `${judges.length} judges`;
    const when = `${SINCE[view.state] ?? "Ended"} ${dayAndClock(view.updatedts)}`;
    return {
        title: `${view.worker.name} with ${who}`,
        line: `${when} · ${pairStateWords(view)} · ${formatTokens(view.tokens)} tokens`,
    };
}

/** The sessions a pair's agents worked in, to link from the read view's foot: the working agent and each judge that has a
 *  session id. `sel` is the Conversations selection key (`<harness>:<session id>`). A side with no session id is left out:
 *  a pair saved before the ids were kept, or an agent that never wrote a transcript. */
export function pairTranscripts(view: PairView): { label: string; sel: string }[] {
    const links: { label: string; sel: string }[] = [];
    if (view.worker.session) {
        links.push({
            label: view.worker.name || "Working agent",
            sel: `${view.worker.harness}:${view.worker.session}`,
        });
    }
    for (const j of view.judges ?? []) {
        if (j.session) {
            links.push({ label: `Judge ${shortTabId(j.tab)}`, sel: `${j.harness}:${j.session}` });
        }
    }
    return links;
}

/** Whether a pair holds `q` (trimmed, without case) in its working agent's name, a judge's short id or its project; an
 *  empty query holds every pair. */
export function pairHistoryMatches(info: PairInfo, q: string): boolean {
    const needle = q.trim().toLowerCase();
    if (needle === "") {
        return true;
    }
    const haystack = [info.worker.name, ...(info.judges ?? []).map((j) => shortTabId(j.tab)), info.project];
    return haystack.some((s) => s.toLowerCase().includes(needle));
}
