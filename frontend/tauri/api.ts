import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as chrome from "./chrome";

// mirrors the Rust InitData (serde camelCase): the single boot prefetch that feeds every
// synchronous getter, so they can satisfy HostApi's sync signatures without awaiting.
export type InitData = {
    wsEndpoint: string;
    webEndpoint: string;
    authKey: string;
    // this shell's version (tauri.conf.json); `version` is the wavesrv it spawned
    appVersion: string;
    version: string;
    buildTime: number;
    platform: string;
    isDev: boolean;
    userName: string;
    hostName: string;
};

const noop = () => {};

// the WebView2 console isn't observable from the dev loop; route logs to the Rust console.
export function hlog(msg: string) {
    invoke("fe_log", { msg }).catch(noop);
}

export function installTauriApi(init: InitData) {
    const api: HostApi = {
        // --- boot ---
        getEnv: (varName: string) => {
            if (varName === "WAVE_SERVER_WS_ENDPOINT") return init.wsEndpoint;
            if (varName === "WAVE_SERVER_WEB_ENDPOINT") return init.webEndpoint;
            return null;
        },
        getAuthKey: () => init.authKey,
        onWaveInit: (callback: (initOpts: WaveInitOpts) => void) => {
            listen<WaveInitOpts>("wave-init", (e) => callback(e.payload)).catch((err) =>
                hlog("onWaveInit listen failed: " + err)
            );
        },
        setWindowInitStatus: (status: "ready" | "wave-ready") => {
            invoke("set_window_init_status", { status }).catch(noop);
        },

        // --- env / identity ---
        getPlatform: () => init.platform as NodeJS.Platform,
        getIsDev: () => init.isDev,
        getUserName: () => init.userName,
        getHostName: () => init.hostName,
        sendLog: (log: string) => hlog(log),

        // --- external links ---
        openExternal: (url: string) => {
            if (url && typeof url === "string") {
                invoke("open_external", { url }).catch(noop);
            } else {
                console.error("Invalid URL passed to openExternal:", url);
            }
        },
        revealPath: (path: string) => {
            invoke("reveal_path", { path }).catch(noop);
        },
        openPath: (path: string) => {
            invoke("open_path", { path }).catch(noop);
        },

        // --- window chrome ---
        getZoomFactor: () => chrome.getZoomFactor(),
        onZoomFactorChange: (cb: (zoomFactor: number) => void) => chrome.onZoomFactorChange(cb),
        onFullScreenChange: (cb: (isFullScreen: boolean) => void) => chrome.onFullScreenChange(cb),
        onControlShiftStateUpdate: (cb: (state: boolean) => void) => chrome.onControlShiftStateUpdate(cb),
    };

    (window as any).api = api;
}
