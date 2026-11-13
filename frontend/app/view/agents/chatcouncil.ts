// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure half of the council cards Chat draws for a council the agent started
// (docs/superpowers/specs/2026-11-14-chat-council-design.md): which `wsh council start` call started which council.
// Where each card sits, and what it says, follow in this file; the cards draw in chatcouncilcard.tsx and the
// conversation (chatconversation.tsx) places them.

/** What a `wsh council start` call's output names: a council that began, one the queue holds (another council runs),
 *  or one the Token burn gate refused, which was saved as not run. */
export type CouncilAnchor =
    // `estimate`: the cost the line quotes, as printed ("≈ 14 calls · ~0.9M tokens")
    | { kind: "started"; councilId: string; estimate?: string }
    | { kind: "queued"; councilId: string }
    // `reason`: the "Not run: …" line above the saved line, prefix included
    | { kind: "notrun"; councilId: string; reason: string };

// `wsh council start` as a command: through a path (`~/.arc/bin/wsh`, `wsh.exe`), in quotes, after `cd x &&`, inside
// `$(…)`; not `wsh council start-now`, `wsh council wait …`, or another program's words.
const COUNCIL_START_COMMAND = /(?:^|[\s;&|(])["']?(?:[^\s"';&|()]*[\\/])?wsh(?:\.exe)?["']?\s+council\s+start(?=\s|$)/;

// the lines `wsh council start` prints (cmd/wsh/cmd/wshcmd-council.go), each read from its start to its end so a line
// that merely quotes an id does not count (a council id is store.go's idRe):
//   councilStartedLine  `council <id> started: <feature> · <mode> · <group> · <seats> · ≈ N calls · ~X tokens`
//   councilQueuedLine   `Queued after <id> (<feature>) · council <id> starts by itself when it ends`: the id that
//                       starts is the new council's own, the one at the end of the line
//   councilNotRunText   `Not run: <reason>` and under it `council <id> saved as not run; Start council in the app runs it`
const ID = "([A-Za-z0-9_-]{1,64})";
const STARTED_LINE = new RegExp(`^[ \\t]*council ${ID} started: [^\\r\\n]*$`, "m");
const ESTIMATE = /(≈ \d+ calls? · ~\S+ tokens)[ \t]*$/;
const QUEUED_LINE = new RegExp(
    `^[ \\t]*Queued after [^\\r\\n]*· council ${ID} starts by itself when it ends[ \\t]*$`,
    "m"
);
const NOT_RUN_LINE = new RegExp(
    `^(?:[ \\t]*(Not run:[^\\r\\n]*)\\r?\\n)?[ \\t]*council ${ID} saved as not run(?=[;\\s]|$)`,
    "m"
);

/** The council a Bash call began: the call must be `wsh council start` and its output must carry the started, queued
 *  or saved-as-not-run line. When the output holds several, the first line wins. A not-run line with no `Not run:`
 *  line above it (the output was cut) reads `Not run` as its reason. */
export function councilStartAnchor(command: string, output: string): CouncilAnchor | null {
    if (!COUNCIL_START_COMMAND.test(command)) {
        return null;
    }
    const found: { index: number; anchor: CouncilAnchor }[] = [];
    const started = STARTED_LINE.exec(output);
    if (started != null) {
        const estimate = ESTIMATE.exec(started[0])?.[1];
        found.push({
            index: started.index,
            anchor: { kind: "started", councilId: started[1], ...(estimate != null ? { estimate } : {}) },
        });
    }
    const queued = QUEUED_LINE.exec(output);
    if (queued != null) {
        found.push({ index: queued.index, anchor: { kind: "queued", councilId: queued[1] } });
    }
    const notRun = NOT_RUN_LINE.exec(output);
    if (notRun != null) {
        found.push({
            index: notRun.index,
            anchor: { kind: "notrun", councilId: notRun[2], reason: notRun[1]?.trim() ?? "Not run" },
        });
    }
    found.sort((a, b) => a.index - b.index);
    return found[0]?.anchor ?? null;
}
