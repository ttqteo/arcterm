// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// When the person last had a council's Memory tab open (ms), per council id, in localStorage: an entry added after it is
// new to them, which the tab's dot and an entry's small dot say (councilmemorymodel.newEntryIds). It is per viewer, so it
// never reaches the council record. councilmemory.tsx snapshots the old time when the tab opens, then writes now.

import type { PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const memorySeenAtom = atomWithStorage<Record<string, number>>("council.memory.seen", {}, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<Record<string, number>>;
