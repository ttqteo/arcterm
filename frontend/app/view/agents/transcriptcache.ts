// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The transcripts read most recently, kept across a switch between agents: the reader (railtranscript.tsx
// useTranscriptWindow) shows the kept window at once when its agent comes back and reads only what was written since,
// instead of a skeleton while the whole tail is read again. A small LRU, so a long session of switching holds a few
// windows, not every transcript ever opened.

export class TranscriptCache<V> {
    private readonly entries = new Map<string, V>();

    constructor(private readonly size: number) {}

    private static key(path: string, runtime: string | undefined): string {
        return `${runtime ?? ""}\u0000${path}`;
    }

    get(path: string, runtime: string | undefined): V | undefined {
        const k = TranscriptCache.key(path, runtime);
        const v = this.entries.get(k);
        if (v !== undefined) {
            // a use makes it the newest again
            this.entries.delete(k);
            this.entries.set(k, v);
        }
        return v;
    }

    put(path: string, runtime: string | undefined, value: V): void {
        if (!path) {
            return;
        }
        const k = TranscriptCache.key(path, runtime);
        this.entries.delete(k);
        this.entries.set(k, value);
        while (this.entries.size > this.size) {
            this.entries.delete(this.entries.keys().next().value);
        }
    }
}
