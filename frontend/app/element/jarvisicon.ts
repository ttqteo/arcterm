// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Jarvis's icon: an arc reactor of our own drawing (canvas jarvis-nav-icon, option F) — the casing ring, six coils
// round it, and a rounded triangular core pointing down with a lit centre. Built with createLucideIcon on Lucide's
// 24 grid, so it takes size and strokeWidth like the rail's other icons and fits a Record<…, LucideIcon>.

import { createLucideIcon } from "lucide-react";

export const JarvisReactor = createLucideIcon("jarvis-reactor", [
    ["circle", { cx: "12", cy: "12", r: "10", key: "casing" }],
    ["path", { d: "M17.46 15.15 19.1 16.1", key: "coil-1" }],
    ["path", { d: "M12 18.3v1.9", key: "coil-2" }],
    ["path", { d: "M6.54 15.15 4.9 16.1", key: "coil-3" }],
    ["path", { d: "M6.54 8.85 4.9 7.9", key: "coil-4" }],
    ["path", { d: "M12 5.7V3.8", key: "coil-5" }],
    ["path", { d: "M17.46 8.85 19.1 7.9", key: "coil-6" }],
    ["path", { d: "M12 16.6 7.4 8.9h9.2Z", key: "core" }],
    ["circle", { cx: "12", cy: "11.6", r: "1.1", fill: "currentColor", stroke: "none", key: "light" }],
]);
