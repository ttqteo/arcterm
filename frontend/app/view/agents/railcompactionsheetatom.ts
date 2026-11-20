// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom } from "jotai";

// true while the rail's compaction summary sheet (railcompactionline.tsx) is open. The key dispatcher counts it as an
// open modal (deriveKeyContext): a sheet is not a dialog there, and the dispatcher runs on window capture ahead of the
// shell's own Escape listener, so without this Escape went to agent:back and left the Agent surface with the sheet
// still on screen. A leaf module (jotai only), like uploadslightboxatom.ts, so the dispatcher can import it.
export const compactionSheetOpenAtom = atom(false);
