// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { FileJoinCommand: vi.fn() } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/global", () => ({ getApi: () => ({ getAuthKey: () => "key" }) }));
vi.mock("@/util/endpoints", () => ({ getWebServerEndpoint: () => "http://127.0.0.1:1234" }));
vi.mock("@/util/fetchutil", () => ({ fetch: vi.fn() }));

import { RpcApi } from "@/app/store/wshclientapi";
import { fetch } from "@/util/fetchutil";
import { resolveRemoteFile } from "./markdown-util";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("resolveRemoteFile", () => {
    // the packaged app's webview blocks a plain fetch to wavesrv (another origin, no CORS headers outside dev): the
    // read goes through fetchutil, which the Tauri host carries
    it("reads a local image through fetchutil, not the webview's own fetch", async () => {
        const globalFetch = vi.fn(() => Promise.reject(new TypeError("Load failed")));
        vi.stubGlobal("fetch", globalFetch);
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fig");
        vi.mocked(RpcApi.FileJoinCommand).mockResolvedValue({
            path: "/r/figures/fig25.png",
            size: 10,
            modtime: 7,
        } as FileInfo);
        vi.mocked(fetch).mockResolvedValue(new Response(new Blob(["png"])));

        const src = await resolveRemoteFile("figures/fig25.png", { baseDir: "/r", connName: "local" });

        expect(src).toBe("blob:fig");
        expect(globalFetch).not.toHaveBeenCalled();
        expect(vi.mocked(fetch).mock.calls[0][0]).toContain("/wave/stream-file?");
    });
});
