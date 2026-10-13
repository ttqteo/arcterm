// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The agent sidebar's row fields (rowfields.ts), kept on this machine like the other Appearance prefs. The stored
// value is read back through rowFieldsOf, so one written by an older shape still shows every field it does not name.

import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { DEFAULT_ROW_FIELDS, rowFieldsOf, type RowField, type RowFields } from "./rowfields";

const storedRowFieldsAtom = atomWithStorage<RowFields>("agent.row.fields", DEFAULT_ROW_FIELDS, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<RowFields>;

export const rowFieldsAtom = atom(
    (get) => rowFieldsOf(get(storedRowFieldsAtom)),
    (get, set, field: RowField, on: boolean) => {
        set(storedRowFieldsAtom, { ...rowFieldsOf(get(storedRowFieldsAtom)), [field]: on });
    }
);
