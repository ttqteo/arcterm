import { invoke } from "@tauri-apps/api/core";
import { createRoot } from "react-dom/client";
import "./tailwind.css";
import { bootWaveCore } from "@/app/boot/boot-core";
import { CockpitRoot } from "@/app/cockpit/cockpit-root";
import { deriveVersionInfo, versionInfoAtom } from "@/app/cockpit/versioninfo";
import { globalStore } from "@/app/store/jotaiStore";
import { installVaultSyncTriggers } from "@/app/store/vaultsync";
import { hlog, installTauriApi, type InitData } from "./api";
import { installChromeListeners } from "./chrome";
import { resolveBootIds } from "./bootids";
import { loadFonts } from "@/util/fontutil";

// WebKit (the macOS webview) has no requestIdleCallback; termwrap's terminal-state cache runs on it.
if (!window.requestIdleCallback) {
    window.requestIdleCallback = (cb) =>
        window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 1) as unknown as number;
    window.cancelIdleCallback = (id) => window.clearTimeout(id);
}

// WebKit's stack is frames only, without the message line Chromium's starts with.
window.addEventListener("error", (e) => {
    const stack: string | undefined = e.error?.stack;
    hlog("WINDOW ERROR: " + (stack?.includes(e.message) ? stack : `${e.message}\n${stack ?? ""}`));
});
window.addEventListener("unhandledrejection", (e) => hlog("UNHANDLED REJECTION: " + (e.reason?.stack ?? String(e.reason))));

async function boot() {
    try {
        const init = await invoke<InitData>("get_init");
        installTauriApi(init);
        installChromeListeners();
        loadFonts(); // register the bundled fonts (fonts swap in on load)
        hlog("init: ws=" + init.wsEndpoint + " web=" + init.webEndpoint + " version=" + init.version);

        const version = deriveVersionInfo(init.appVersion, init.version, init.buildTime, init.platform);
        globalStore.set(versionInfoAtom, version);
        if (version.mismatch) {
            // not fatal: an old wavesrv boots fine and only fails once the frontend calls a command
            // it doesn't have. Say so here and in the app bar so the cause isn't a mystery later.
            hlog(
                `VERSION MISMATCH: app ${version.app} vs wavesrv ${version.server} — dist/bin is stale, run \`task build:backend\``
            );
        }
        if (!init.webEndpoint) {
            // wavesrv never reported its endpoints; without this an empty endpoint builds
            // http:///wave/service, which the URL parser rewrites to host "wave" and the
            // http scope rejects with a misleading "url not allowed" error.
            throw new Error("backend endpoints unavailable: wavesrv did not report its ports (startup timed out)");
        }

        const ids = await resolveBootIds();
        hlog("bootIds: " + JSON.stringify(ids));

        await bootWaveCore({
            tabId: ids.tabId,
            clientId: ids.clientId,
            windowId: ids.windowId,
            activate: true,
        } as WaveInitOpts);

        installVaultSyncTriggers();
        createRoot(document.getElementById("main")).render(<CockpitRoot />);
        hlog("cockpit rendered");
    } catch (e: any) {
        hlog("BOOT ERROR: " + (e?.stack ?? e?.message ?? String(e)));
        const el = document.getElementById("main") ?? document.body;
        el.innerHTML = "<pre style='color:#f88;padding:20px'>BOOT ERROR: " + String(e) + "</pre>";
    }
}

boot();
