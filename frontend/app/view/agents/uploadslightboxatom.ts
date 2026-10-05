// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom } from "jotai";

// true while the Uploads list's image lightbox (uploadslist.tsx) is open. The key dispatcher counts it as an open
// modal (deriveKeyContext): the lightbox is a ModalShell driven by component state, which the dispatcher cannot see,
// and the dispatcher runs on window capture ahead of the shell's own Escape listener, so without this Escape would
// leave the Agent surface with the lightbox still on screen, and j/k, the arrows, d and f would act behind it.
// A leaf module (jotai only), like finalshotsstore.ts, so the dispatcher can import it without pulling in the
// uploads store.
export const uploadsLightboxOpenAtom = atom(false);
