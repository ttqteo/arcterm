// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The agent header's button choices (headerbuttons.ts), kept on this machine like the other Appearance prefs. The
// stored value is read back through headerButtonsOf, so one written by an older shape keeps every button's default it
// does not name.

import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { DEFAULT_HEADER_BUTTONS, headerButtonsOf, type HeaderButton, type HeaderButtons } from "./headerbuttons";

const storedHeaderButtonsAtom = atomWithStorage<HeaderButtons>(
    "agent.header.buttons",
    DEFAULT_HEADER_BUTTONS,
    undefined,
    { getOnInit: true }
) as PrimitiveAtom<HeaderButtons>;

export const headerButtonsAtom = atom(
    (get) => headerButtonsOf(get(storedHeaderButtonsAtom)),
    (get, set, button: HeaderButton, on: boolean) => {
        set(storedHeaderButtonsAtom, { ...headerButtonsOf(get(storedHeaderButtonsAtom)), [button]: on });
    }
);
