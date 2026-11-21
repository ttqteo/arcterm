// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { digitHintAtom } from "@/app/cockpit/digithints";
import { deriveKeyContext } from "@/app/store/keybindings/dispatcher";
import { bindingsAtom } from "@/app/store/keybindings/store";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { keyTipLabel } from "./keytipmodel";

// A button's ⌥ chord, a small badge on its top-right corner while Option (Alt) is held on its own (digithints.ts, the
// same hold that numbers the tree's agents for ⌥1–9). It reads the binding by id and shows only while that binding
// would act on a press now, so a badge never names a key that does nothing. Absolutely placed: the button (its
// positioned parent) does not shift while the key is down. `show` lets a button hide it where the binding's own
// conditions cannot tell (an agent that cannot chat).
export function KeyTip({ id, show = true, className }: { id: string; show?: boolean; className?: string }) {
    const held = useAtomValue(digitHintAtom) === "alt";
    const bindings = useAtomValue(bindingsAtom);
    if (!held || !show) {
        return null;
    }
    const b = bindings.find((x) => x.id === id);
    const label = b == null ? null : keyTipLabel(b.keys);
    if (b == null || label == null || (b.when != null && !b.when(deriveKeyContext()))) {
        return null;
    }
    return (
        <kbd
            data-key-tip={id}
            aria-hidden
            className={cn(
                "pointer-events-none absolute -right-[5px] -top-[6px] z-10 flex h-[14px] min-w-[14px] items-center justify-center rounded-[3px] bg-accent px-[3px] font-sans text-[9.5px] font-bold leading-none text-background",
                className
            )}
        >
            {label}
        </kbd>
    );
}
