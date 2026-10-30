// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The clicks of the council Discussion that call wavesrv: one at a time per key, the refusal kept to show where it was
// clicked. councildiscussion.tsx (its header, the pause) and councilchat.tsx (a held draft, Retry) share one.

import { useCallback, useRef, useState } from "react";
import type { CouncilCall } from "./councilstore";

export interface Actions {
    error: string | null;
    busy: ReadonlySet<string>;
    run: (key: string, what: string, fn: () => Promise<CouncilCall<unknown>>) => Promise<boolean>;
}

export function useActions(): Actions {
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
    const live = useRef(new Set<string>());
    const run = useCallback(async (key: string, what: string, fn: () => Promise<CouncilCall<unknown>>) => {
        if (live.current.has(key)) {
            return false;
        }
        live.current.add(key);
        setBusy(new Set(live.current));
        setError(null);
        const r = await fn();
        live.current.delete(key);
        setBusy(new Set(live.current));
        // `=== false` because the non-strict tsconfig narrows a union only on a comparison
        if (r.ok === false) {
            setError(`${what} failed: ${r.error}`);
        }
        return r.ok;
    }, []);
    return { error, busy, run };
}
