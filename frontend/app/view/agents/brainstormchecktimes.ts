// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How long this machine's past builder checks took, for the clock a pending check draws: the Brainstorm tab's (the
// pane's CheckWait) and the builder check card's in Chat (chatbrainstormcheck.tsx) read it the same way.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useEffect, useState } from "react";

// null until read, or when they could not be. Read again for each check (key, its run), so the one before it counts
export function useCheckTimes(key: string | undefined): BrainstormCheckTimes | null {
    const [times, setTimes] = useState<BrainstormCheckTimes | null>(null);
    useEffect(() => {
        let live = true;
        RpcApi.BrainstormCheckTimesCommand(TabRpcClient)
            .then((t) => live && setTimes(t))
            .catch((e) => console.error("brainstorm: reading past builder check times:", e));
        return () => {
            live = false;
        };
    }, [key]);
    return times;
}
