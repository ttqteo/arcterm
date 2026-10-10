// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// One operation at a time, in the order asked. The folded float's window calls (floatstore.ts) await Tauri round trips,
// and two of them interleaving (a restore and the chat's resize, a fold and a leave) left the window at the wrong size.
// A failed operation reaches only its caller and does not stop the next. Pure.

export function serialQueue(): <T>(op: () => Promise<T>) => Promise<T> {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(op: () => Promise<T>): Promise<T> => {
        const run = tail.then(op);
        tail = run.catch(() => {});
        return run;
    };
}
