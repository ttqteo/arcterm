// the reply as it streams, for arcterm's Chat: register.ts's turn.step hook gathers the text of each block of a step's
// response here, and writes it about every LIVE_WRITE_MS to ~/.arc/live/<session id>.json, which wavesrv watches
// (pkg/wshrpc/wshserver/livereply.go) and Chat draws until the transcript holds the block (chatlive.ts). kept free of
// the engine so vitest can run it.
//
// thinking blocks go too: with Claude Code's thinkingDisplay "updates", what Claude says between tool calls can arrive
// as a thinking block holding a summary of it (a narration block), and the mod cannot tell it from real thinking. Chat
// draws a thinking block only when the transcript shows that mode, where real thinking streams no text.

/** The least time between two writes of one step's reply, in ms. */
export const LIVE_WRITE_MS = 100;

export type LiveKind = "text" | "thinking";

/** One block of the response: the concatenation of its chunks so far. */
export interface LiveBlock {
    index: number;
    kind: LiveKind;
    text: string;
}

/** The file's content. `turn` and `step` name the model request; `done` once its response ended (whole, failed or
 *  interrupted); `at` when this was written, in ms. */
export interface LiveReply {
    v: 1;
    turn: string;
    step: number;
    blocks: LiveBlock[];
    done: boolean;
    at: number;
}

// a session id names a file, so nothing that leaves the live directory
const SESSION_ID = /^[A-Za-z0-9_-]+$/;

/** The session's live reply file, or null with no home or an id that is no file name. */
export function liveFile(home: string | undefined, sessionId: string): string | null {
    if (!home || !SESSION_ID.test(sessionId)) {
        return null;
    }
    return `${home.replace(/[\\/]+$/, "")}/.arc/live/${sessionId}.json`;
}

/** The text blocks of one step's response, gathered as their chunks arrive. */
export class LiveGather {
    private readonly blocks = new Map<number, LiveBlock>();
    private lastWrite = -Infinity;

    constructor(
        readonly turn: string,
        readonly step: number
    ) {}

    /** A chunk of block `index`; an empty one adds nothing (a thinking block whose text is not shown streams those). */
    add(kind: LiveKind, index: number, text: string): void {
        if (text === "") {
            return;
        }
        const block = this.blocks.get(index);
        if (block == null) {
            this.blocks.set(index, { index, kind, text });
        } else {
            block.text += text;
        }
    }

    /** Whether any block has text: a step that only called tools writes nothing. */
    hasText(): boolean {
        return this.blocks.size > 0;
    }

    /** Whether a write is due at `now`: there is text, and the last write is LIVE_WRITE_MS old. */
    due(now: number): boolean {
        return this.hasText() && now - this.lastWrite >= LIVE_WRITE_MS;
    }

    /** The file's content at `now`, which counts as a write. */
    payload(done: boolean, now: number): string {
        this.lastWrite = now;
        const reply: LiveReply = {
            v: 1,
            turn: this.turn,
            step: this.step,
            blocks: [...this.blocks.values()].sort((a, b) => a.index - b.index),
            done,
            at: now,
        };
        return JSON.stringify(reply);
    }
}

/** Writes one file in order, one write at a time: a text given while a write runs replaces any still waiting, so the
 *  file ends with the last one. After a failed write it writes nothing more, and `onError` hears it once. */
export function serialWriter(
    write: (text: string) => Promise<void>,
    onError: (err: unknown) => void
): { write: (text: string) => void; idle: () => Promise<void> } {
    let waiting: string | null = null;
    let running: Promise<void> | null = null;
    let broken = false;
    const pump = async () => {
        while (waiting !== null && !broken) {
            const text = waiting;
            waiting = null;
            try {
                await write(text);
            } catch (err) {
                broken = true;
                onError(err);
            }
        }
        running = null;
    };
    return {
        write(text: string) {
            if (broken) {
                return;
            }
            waiting = text;
            if (running === null) {
                running = pump();
            }
        },
        // resolves once nothing is written or waiting; for tests
        async idle() {
            while (running !== null) {
                await running;
            }
        },
    };
}
