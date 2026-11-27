// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom, type PrimitiveAtom } from "jotai";

// Whether the agent header's layout menu (gridlayoutmenu.tsx) is open: the key dispatcher counts it as a modal, so its
// Escape closes the menu and the surface's own Escape (leave, stop a turn) stands down. A file of its own so the
// dispatcher does not import the grid stores.
export const gridLayoutMenuOpenAtom = atom(false) as PrimitiveAtom<boolean>;
