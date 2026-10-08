// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Terminal: defaults for every agent and shell terminal. All of it is settings.json (term:*).

import { getSettingsKeyAtom } from "@/app/store/global";
import { useAtomValue } from "jotai";
import { coerceFontSize, coerceScrollback } from "../cockpitprefsstore";
import { DEFAULT_TERM_FONT, MONO_FONTS, stackOf } from "../fonts";
import { Segmented, SettingCard, SettingRow, Stepper, Toggle, writeConfig } from "../settingsui";

export function TerminalPage() {
    const fontSize = (useAtomValue(getSettingsKeyAtom("term:fontsize")) as number) ?? 12;
    const scrollback = (useAtomValue(getSettingsKeyAtom("term:scrollback")) as number) ?? 1000;
    const cursorRaw = (useAtomValue(getSettingsKeyAtom("term:cursor")) as string) ?? "block";
    const cursorBlink = (useAtomValue(getSettingsKeyAtom("term:cursorblink")) as boolean) ?? false;
    const copyOnSelect = (useAtomValue(getSettingsKeyAtom("term:copyonselect")) as boolean) ?? false;
    // the terminal face is stored as the full stack string; match it back to a catalog id for the control
    const termFontStack = (useAtomValue(getSettingsKeyAtom("term:fontfamily")) as string) ?? "";
    const termFontId = MONO_FONTS.find((f) => f.stack === termFontStack)?.id ?? DEFAULT_TERM_FONT;
    // each option draws in the face it names, so the choice is judged by looking at it
    const monoOpts = MONO_FONTS.map((f) => ({ id: f.id, label: f.label, fontFamily: f.stack }));

    const cursor = cursorRaw === "bar" || cursorRaw === "underline" ? cursorRaw : "block";

    const stepFontSize = (dir: -1 | 1) => {
        const next = coerceFontSize(String(fontSize + dir));
        if (next != null && next !== fontSize) writeConfig({ "term:fontsize": next });
    };
    const stepScrollback = (dir: -1 | 1) => {
        const next = coerceScrollback(String(Math.max(100, scrollback + dir * 250)));
        if (next != null && next !== scrollback) writeConfig({ "term:scrollback": next });
    };

    return (
        <>
            <SettingCard id="text" label="Text">
                <SettingRow id="fonts.term">
                    <Segmented
                        options={monoOpts}
                        value={termFontId}
                        onChange={(id) => writeConfig({ "term:fontfamily": stackOf(MONO_FONTS, id) })}
                    />
                </SettingRow>
                <SettingRow id="terminal.fontsize">
                    <Stepper value={fontSize} onStep={stepFontSize} ariaLabel="font size" />
                </SettingRow>
            </SettingCard>
            <SettingCard id="cursor" label="Cursor">
                <SettingRow id="terminal.cursor">
                    <Segmented
                        options={[
                            { id: "block", label: "Block" },
                            { id: "bar", label: "Bar" },
                            { id: "underline", label: "Underline" },
                        ]}
                        value={cursor}
                        onChange={(v) => writeConfig({ "term:cursor": v })}
                    />
                </SettingRow>
                <SettingRow id="terminal.cursorblink">
                    <Toggle
                        on={cursorBlink}
                        onToggle={() => writeConfig({ "term:cursorblink": !cursorBlink })}
                        label="Cursor blink"
                    />
                </SettingRow>
            </SettingCard>
            <SettingCard id="behavior" label="Behavior">
                <SettingRow id="terminal.scrollback">
                    <Stepper value={scrollback} onStep={stepScrollback} ariaLabel="scrollback" />
                </SettingRow>
                <SettingRow id="terminal.copyonselect">
                    <Toggle
                        on={copyOnSelect}
                        onToggle={() => writeConfig({ "term:copyonselect": !copyOnSelect })}
                        label="Copy on select"
                    />
                </SettingRow>
            </SettingCard>
        </>
    );
}
