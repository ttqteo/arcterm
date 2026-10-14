// the nudge to record ideas: each prompt the person submits ticks the session's counter through `wsh idea tick`,
// and when ideas have stopped coming the nudge it prints is added to the conversation as a row the model reads.
// the 3-prompt rule itself is Go (ideastore.Tick). kept free of the engine so vitest can run it, the effects
// injected; register.ts holds the classic.UserPromptSubmit hook that supplies them.
import type { Ran } from "./mention-core";

export type NudgeIO = {
    run(argv: string[]): Promise<Ran>;
    append(text: string): Promise<void>;
    log(msg: string): void;
};

// null when tick printed no nudge; wsh ends a nudge with a newline
export function nudgeRow(nudge: string): string | null {
    const text = nudge.trim();
    return text === "" ? null : `arc: ${text}`;
}

// never throws: the prompt must not wait on, or fail with, an idea counter. a dropped tick only delays a nudge
export async function promptNudge(io: NudgeIO, wsh: string, sessionId: string): Promise<void> {
    let ran: Ran;
    try {
        ran = await io.run([wsh, "idea", "tick", "--session", sessionId]);
    } catch (err) {
        io.log(`arc: wsh idea tick failed: ${String(err)}`);
        return;
    }
    if (ran.exitCode !== 0) {
        io.log(`arc: wsh idea tick exited ${ran.exitCode}: ${ran.stderr.trim()}`);
        return;
    }
    const row = nudgeRow(ran.stdout);
    if (row === null) {
        return;
    }
    try {
        await io.append(row);
    } catch (err) {
        io.log(`arc: adding the ideas nudge failed: ${String(err)}`);
    }
}
