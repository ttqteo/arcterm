// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcApi } from "@/app/store/wshclientapi";
import { handleWaveEvent, setWpsRpcClient, waveEventSubscribeSingle, waveEventUnsubscribe } from "./wps";

const win = vi.hoisted(() => ({ preview: false }));

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { EventSubCommand: vi.fn(), EventUnsubCommand: vi.fn() },
}));
vi.mock("@/app/store/windowtype", () => ({ isPreviewWindow: () => win.preview }));

function deterministicCrypto() {
    let n = 0;
    return { randomUUID: () => "id-" + ++n };
}

const client = { routeId: "wps-test" } as any;

describe("wps subscribe/unsubscribe", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setWpsRpcClient(client);
        vi.stubGlobal("crypto", deterministicCrypto() as any);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        win.preview = false;
    });

    it("still unsubscribes the other events when one batch id is unknown", () => {
        const h1 = vi.fn();
        const h2 = vi.fn();
        waveEventSubscribeSingle({ eventType: "e1" as any, handler: h1 }); // id-1
        waveEventSubscribeSingle({ eventType: "e2" as any, handler: h2 }); // id-2
        // unknown id first (would abort the loop under the old `return`); valid e2 sub second
        waveEventUnsubscribe({ id: "id-999", eventType: "e2" }, { id: "id-2", eventType: "e2" });
        // e2 emptied -> unsubscribed server-side even though an earlier batch entry was unknown
        expect((RpcApi.EventUnsubCommand as any)).toHaveBeenCalledWith(expect.anything(), "e2", expect.anything());
        // and the unsubscribed handler no longer receives events, while the untouched one still does
        handleWaveEvent({ event: "e2" } as any);
        expect(h2).not.toHaveBeenCalled();
        handleWaveEvent({ event: "e1" } as any);
        expect(h1).toHaveBeenCalledTimes(1);
    });

    it("subscribes a scoped handler to just its scope", () => {
        waveEventSubscribeSingle({ eventType: "scoped" as any, scope: "block:1", handler: vi.fn() });
        expect(RpcApi.EventUnsubCommand).not.toHaveBeenCalled();
        expect(RpcApi.EventSubCommand).toHaveBeenCalledExactlyOnceWith(
            client,
            { event: "scoped", scopes: ["block:1"], allscopes: false },
            { noresponse: true }
        );
    });

    it("subscribes an unscoped handler to all scopes", () => {
        waveEventSubscribeSingle({ eventType: "unscoped" as any, handler: vi.fn() });
        expect(RpcApi.EventSubCommand).toHaveBeenCalledExactlyOnceWith(
            client,
            { event: "unscoped", scopes: [], allscopes: true },
            { noresponse: true }
        );
    });

    it("widens to all scopes once an unscoped handler joins a scoped one", () => {
        waveEventSubscribeSingle({ eventType: "widen" as any, scope: "block:1", handler: vi.fn() });
        waveEventSubscribeSingle({ eventType: "widen" as any, handler: vi.fn() });
        expect(RpcApi.EventSubCommand).toHaveBeenLastCalledWith(
            client,
            { event: "widen", scopes: [], allscopes: true },
            { noresponse: true }
        );
    });

    it("unsubscribes server-side once the last handler leaves", () => {
        const unsub = waveEventSubscribeSingle({ eventType: "last" as any, handler: vi.fn() });
        unsub();
        expect(RpcApi.EventUnsubCommand).toHaveBeenCalledExactlyOnceWith(client, "last", { noresponse: true });
    });

    it("sends nothing to the server from a preview window", () => {
        win.preview = true;
        const unsub = waveEventSubscribeSingle({ eventType: "preview" as any, handler: vi.fn() });
        unsub();
        expect(RpcApi.EventSubCommand).not.toHaveBeenCalled();
        expect(RpcApi.EventUnsubCommand).not.toHaveBeenCalled();
    });

    it("ignores an unsubscribe for an event nobody subscribed to", () => {
        expect(() => waveEventUnsubscribe({ id: "id-1", eventType: "never" })).not.toThrow();
        expect(RpcApi.EventSubCommand).not.toHaveBeenCalled();
        expect(RpcApi.EventUnsubCommand).not.toHaveBeenCalled();
    });

    it("removes only the handler whose id matches and keeps the event subscribed", () => {
        const first = vi.fn();
        const second = vi.fn();
        waveEventSubscribeSingle({ eventType: "pair" as any, handler: first }); // id-1
        waveEventSubscribeSingle({ eventType: "pair" as any, handler: second }); // id-2
        waveEventUnsubscribe({ id: "id-2", eventType: "pair" });
        handleWaveEvent({ event: "pair" } as any);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();
        expect(RpcApi.EventUnsubCommand).not.toHaveBeenCalled();
        expect(RpcApi.EventSubCommand).toHaveBeenCalledTimes(3);
        expect(RpcApi.EventSubCommand).toHaveBeenLastCalledWith(
            client,
            { event: "pair", scopes: [], allscopes: true },
            { noresponse: true }
        );
    });

    it("keeps every handler when the id is unknown", () => {
        const first = vi.fn();
        const second = vi.fn();
        waveEventSubscribeSingle({ eventType: "keep" as any, handler: first });
        waveEventSubscribeSingle({ eventType: "keep" as any, handler: second });
        waveEventUnsubscribe({ id: "id-999", eventType: "keep" });
        handleWaveEvent({ event: "keep" } as any);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        expect(RpcApi.EventSubCommand).toHaveBeenCalledTimes(2);
    });
});
