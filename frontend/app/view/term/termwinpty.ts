// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { IWindowsPty } from "@xterm/xterm";

// xterm only asks which side of build 21376 (the first ConPTY that reflows its own buffer) Windows is on
const Windows11Build = 22000;
const Windows10Build = 19045;

// xterm's `windowsPty` for a terminal whose shell runs under ConPTY, as every local shell does on Windows. Told so,
// xterm adds blank rows at the bottom when a pane grows, as ConPTY does, instead of pulling scrollback down into the
// viewport; left untold, the two disagreed on which row was which after every resize, and a TUI repainting by row
// landed its frame on the wrong lines. platformVersion is the User-Agent Client Hints value: its major is 13 or more on
// Windows 11 and 1 to 12 on Windows 10. Without it the build is left out, and xterm keeps its own reflow, as it does
// on Windows 11.
export function windowsPtyFor(platform: string, platformVersion: string | null): IWindowsPty | undefined {
    if (platform !== "win32") {
        return undefined;
    }
    const major = parseInt(platformVersion ?? "", 10);
    if (!Number.isFinite(major) || major < 1) {
        return { backend: "conpty" };
    }
    return { backend: "conpty", buildNumber: major >= 13 ? Windows11Build : Windows10Build };
}

let platformVersionPromise: Promise<string | null> | null = null;

// the Windows platform version from the webview's client hints, read once; null where they are not offered
export function readPlatformVersion(): Promise<string | null> {
    if (platformVersionPromise == null) {
        const uaData = (navigator as { userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<any> } })
            .userAgentData;
        platformVersionPromise =
            uaData?.getHighEntropyValues == null
                ? Promise.resolve(null)
                : uaData
                      .getHighEntropyValues(["platformVersion"])
                      .then((v) => (typeof v?.platformVersion === "string" ? v.platformVersion : null))
                      .catch(() => null);
    }
    return platformVersionPromise;
}
