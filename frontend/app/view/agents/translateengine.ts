// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Quick translate's engine switch (docs/superpowers/specs/2026-10-29-rail-translate-design.md): who answers a request.
// A CDP scenario's stub first (dev builds only), else wavesrv's Translate command, which asks Google and, on a Mac,
// falls back to Apple Translation on the device when Google cannot answer (pkg/translate/engine.go). Called by
// translatestore.ts.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { TRANSLATE_TIMEOUT_MS, type TranslateRequest, type TranslateResult } from "./translatemodel";

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

export async function translate(req: TranslateRequest): Promise<TranslateResult> {
    const stub = devStub();
    if (stub != null) {
        return await stub(req);
    }
    return RpcApi.TranslateCommand(TabRpcClient, req, { timeout: TRANSLATE_TIMEOUT_MS });
}
