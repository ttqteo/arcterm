// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// One value, one commit. A text field that commits on Enter and on blur fires twice for one Enter (the
// Enter handler blurs the field), so the gate drops a commit of a value whose earlier commit is still in
// flight. Once that commit settles — true, false or thrown — the value can be committed again, so a
// failed write can be retried.

export type CommitGate = {
    // Returns the commit's promise, or null when the same value is already being committed.
    commit(value: string, onCommit: (v: string) => Promise<boolean>): Promise<boolean> | null;
};

export function createCommitGate(): CommitGate {
    const inFlight = new Set<string>();
    return {
        commit(value, onCommit) {
            if (inFlight.has(value)) {
                return null;
            }
            inFlight.add(value);
            return (async () => {
                try {
                    return await onCommit(value);
                } finally {
                    inFlight.delete(value);
                }
            })();
        },
    };
}
