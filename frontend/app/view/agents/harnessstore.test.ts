// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi, beforeEach } from "vitest";

const listHarnesses = vi.fn();
const refreshRouteCatalog = vi.fn();
const setConfig = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        ListHarnessesCommand: (...a: any[]) => listHarnesses(...a),
        RefreshRouteCatalogCommand: (...a: any[]) => refreshRouteCatalog(...a),
        SetConfigCommand: (...a: any[]) => setConfig(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/global";
import { harnessPreferenceAtom, harnessesAtom, harnessesLoadingAtom, initHarnessPreference, leadRuntimes, leadRuntimesAtom, loadHarnesses, setPreferredHarness, setPreferredRoute } from "./harnessstore";

describe("harnessstore model catalog freshness", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        globalStore.set(harnessesAtom, []);
        globalStore.set(harnessPreferenceAtom, { route: null, persistedRoute: null, saving: false });
        listHarnesses.mockResolvedValue({ harnesses: [] });
        refreshRouteCatalog.mockResolvedValue(undefined);
        setConfig.mockResolvedValue(undefined);
    });

    it("refreshes the catalog before re-listing when forced", async () => {
        await loadHarnesses(true);
        expect(refreshRouteCatalog).toHaveBeenCalledTimes(1);
        expect(listHarnesses).toHaveBeenCalledTimes(1);
        expect(refreshRouteCatalog.mock.invocationCallOrder[0]).toBeLessThan(listHarnesses.mock.invocationCallOrder[0]);
    });

    it("does not refresh when not forced", async () => {
        await loadHarnesses();
        expect(refreshRouteCatalog).not.toHaveBeenCalled();
        expect(listHarnesses).toHaveBeenCalledTimes(1);
    });

    it("sends exactly the runtime and model settings", async () => {
        setPreferredRoute({ runtime: "pi", model: "opencode/deepseek-v4-pro" });
        await vi.waitFor(() => expect(setConfig).toHaveBeenCalled());
        expect(setConfig.mock.calls[0][1]).toEqual({
            "harness:preferredruntime": "pi",
            "harness:preferredmodel": "opencode/deepseek-v4-pro",
        });
    });

    // the server takes the pair together, so a runtime default has to clear the previous runtime's model
    it("clears the persisted model when the route is the runtime default", async () => {
        setPreferredRoute({ runtime: "claude" });
        await vi.waitFor(() => expect(setConfig).toHaveBeenCalled());
        expect(setConfig.mock.calls[0][1]).toEqual({ "harness:preferredruntime": "claude", "harness:preferredmodel": "" });
    });

    it("treats a model-only change as a change worth saving", async () => {
        initHarnessPreference("pi");
        setPreferredRoute({ runtime: "pi", model: "opencode/deepseek-v4-pro" });
        await vi.waitFor(() => expect(setConfig).toHaveBeenCalled());
        expect(setConfig.mock.calls[0][1]["harness:preferredmodel"]).toBe("opencode/deepseek-v4-pro");
    });

    it("keeps the pinned model when the harness picker re-picks the current runtime", () => {
        globalStore.set(harnessesAtom, [
            { runtime: "pi", label: "Pi", routecapabilities: [{ runtime: "pi", resolvedmodel: "operator default" }] },
            { runtime: "claude", label: "Claude", routecapabilities: [{ runtime: "claude", resolvedmodel: "operator default" }] },
        ] as HarnessInfo[]);
        initHarnessPreference("pi", "opencode/deepseek-v4-pro");

        setPreferredHarness("pi");
        expect(globalStore.get(harnessPreferenceAtom).route).toEqual({ runtime: "pi", model: "opencode/deepseek-v4-pro" });

        // a different harness has a different id namespace, so the model cannot come along
        setPreferredHarness("claude");
        expect(globalStore.get(harnessPreferenceAtom).route).toEqual({ runtime: "claude" });
    });

    it("refuses a harness with no runtime-default route", () => {
        globalStore.set(harnessesAtom, [
            { runtime: "codex", label: "Codex", routecapabilities: [] },
            {
                runtime: "pi",
                label: "Pi",
                routecapabilities: [{ runtime: "pi", model: "opencode/deepseek-v4-pro", resolvedmodel: "opencode/deepseek-v4-pro" }],
            },
        ] as HarnessInfo[]);
        setPreferredHarness("codex");
        expect(globalStore.get(harnessPreferenceAtom).error).toContain("codex");
        setPreferredHarness("pi");
        expect(globalStore.get(harnessPreferenceAtom).error).toContain("pi");
        expect(setConfig).not.toHaveBeenCalled();
    });

    it("seeds the preference from a persisted model", () => {
        initHarnessPreference("claude", "sonnet");
        expect(globalStore.get(harnessPreferenceAtom).route).toEqual({ runtime: "claude", model: "sonnet" });
    });
});

describe("harnessstore catalog load resilience", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        globalStore.set(harnessesAtom, []);
        refreshRouteCatalog.mockResolvedValue(undefined);
    });

    it("gives the catalog RPC more than the 5s default budget", async () => {
        listHarnesses.mockResolvedValue({ harnesses: [] });
        await loadHarnesses();
        expect(listHarnesses.mock.calls[0][1]?.timeout).toBeGreaterThan(5000);
    });

    it("keeps the loaded catalog when a refresh fails", async () => {
        const loaded = [{ runtime: "pi", label: "Pi" }] as HarnessInfo[];
        globalStore.set(harnessesAtom, loaded);
        listHarnesses.mockRejectedValue(new Error("EC-TIME: timeout"));
        await loadHarnesses(true);
        expect(globalStore.get(harnessesAtom)).toEqual(loaded);
    });

    it("reports loading while the catalog is in flight and clears it when the load fails", async () => {
        let reject!: (e: Error) => void;
        listHarnesses.mockReturnValue(new Promise((_resolve, r) => (reject = r)));
        const pending = loadHarnesses();
        expect(globalStore.get(harnessesLoadingAtom)).toBe(true);
        reject(new Error("EC-TIME: timeout"));
        await pending;
        expect(globalStore.get(harnessesLoadingAtom)).toBe(false);
    });
});

describe("leadRuntimes", () => {
    const h = (runtime: string, leadcapable: boolean, installed = true) => ({ runtime, leadcapable, installed }) as HarnessInfo;
    const catalog = [h("agy", false), h("claude", true), h("pi", true), h("codex", true, false)];

    it("keeps claude and pi, and drops agy and uninstalled harnesses", () => {
        expect(leadRuntimes(catalog)).toEqual(["claude", "pi"]);
    });

    it("derives from the loaded catalog", () => {
        globalStore.set(harnessesAtom, catalog);
        expect(globalStore.get(leadRuntimesAtom)).toEqual(["claude", "pi"]);
    });
});
