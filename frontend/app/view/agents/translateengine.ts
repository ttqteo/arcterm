// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Quick translate's engine switch (docs/superpowers/specs/2026-10-29-rail-translate-design.md): who answers a request.
// A CDP scenario's stub first (dev builds only), then the OS's native on-device translator, then wavesrv's Translate
// command, which asks Google. Called by translatestore.ts.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { TranslateRequest, TranslateResult } from "./translatemodel";

type TranslateStub = (req: TranslateRequest) => TranslateResult | Promise<TranslateResult>;

// scenarios.mjs sets window.__arcTranslateStub so a scenario never waits on Google; the check is compiled out of a
// production build
function devStub(): TranslateStub | null {
    if (!import.meta.env.DEV || typeof window === "undefined") {
        return null;
    }
    const stub = (window as unknown as { __arcTranslateStub?: unknown }).__arcTranslateStub;
    return typeof stub === "function" ? (stub as TranslateStub) : null;
}

// Apple Translation on a Mac, which plan 2 (the Swift bridge, done on a Mac) fills in. Null means "native unavailable":
// the OS has none, or it cannot translate this pair, and the request goes to Google.
async function nativeTranslate(_req: TranslateRequest): Promise<TranslateResult | null> {
    return null;
}

export async function translate(req: TranslateRequest): Promise<TranslateResult> {
    const stub = devStub();
    if (stub != null) {
        return await stub(req);
    }
    const native = await nativeTranslate(req);
    if (native != null) {
        return native;
    }
    return RpcApi.TranslateCommand(TabRpcClient, req);
}
