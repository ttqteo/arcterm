// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The blob: URLs a Markdown preview draws its local images from, by the src they were read for. Markdown remounts its
// images on every render, so an image found here draws at once instead of blinking while it is read again. Pure but
// for `retire`, the caller's way to let go of a URL (URL.revokeObjectURL, late enough for an <img> still loading it).

export type BlobEntry = { stamp: string; url: string; bytes: number };

export class BlobCache {
    private entries = new Map<string, BlobEntry>(); // least recently used first
    private total = 0;

    constructor(
        private budget: number,
        private retire: (url: string) => void
    ) {}

    // the entry for `key`; with `stamp`, only one read at that stamp (the file unchanged since)
    get(key: string, stamp?: string): BlobEntry | undefined {
        const e = this.entries.get(key);
        if (e == null || (stamp != null && e.stamp !== stamp)) {
            return undefined;
        }
        this.entries.delete(key);
        this.entries.set(key, e);
        return e;
    }

    put(key: string, entry: BlobEntry) {
        const old = this.entries.get(key);
        if (old != null) {
            this.entries.delete(key);
            this.total -= old.bytes;
            if (old.url !== entry.url) {
                this.retire(old.url);
            }
        }
        this.entries.set(key, entry);
        this.total += entry.bytes;
        // the oldest go until the rest fit; the newest stays even alone over the budget, as it is about to be drawn
        for (const [k, e] of this.entries) {
            if (this.total <= this.budget || k === key) {
                break;
            }
            this.entries.delete(k);
            this.total -= e.bytes;
            this.retire(e.url);
        }
    }
}
