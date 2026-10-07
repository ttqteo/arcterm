import { describe, expect, it } from "vitest";
import { appPids } from "./install-mac.mjs";

const APP = "/Applications/arcterm.app";

describe("appPids", () => {
    it("names the processes that run from inside the installed bundle", () => {
        const ps = [
            "  101 /sbin/launchd",
            "15922 /Applications/arcterm.app/Contents/MacOS/wave-tauri",
            "16319 /Applications/arcterm.app/Contents/Resources/bin/wavesrv.arm64 --wavedata x",
            "  777 /bin/zsh -l",
        ].join("\n");
        expect(appPids(ps, APP)).toEqual([15922, 16319]);
    });

    it("leaves the dev app, a build in the repo and a look-alike bundle alone", () => {
        const ps = [
            "201 /Users/me/arcterm/src-tauri/target/debug/wave-tauri",
            "202 /Users/me/arcterm/src-tauri/target/release/bundle/macos/arcterm.app/Contents/MacOS/wave-tauri",
            "203 /Applications/arcterm.app.old/Contents/MacOS/wave-tauri",
            "204 /usr/bin/grep /Applications/arcterm.app/Contents/MacOS/wave-tauri",
        ].join("\n");
        expect(appPids(ps, APP)).toEqual([]);
    });

    it("reads nothing from empty output", () => {
        expect(appPids("", APP)).toEqual([]);
    });
});
