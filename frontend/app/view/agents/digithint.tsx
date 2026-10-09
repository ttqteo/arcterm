// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The digit a held modifier jumps to, drawn over a row's leading mark: Ctrl over the rail's surfaces, Alt over the
// Active list's agents. The mark stays in place, hidden, so the row does not shift while the key is down.
export function DigitHint({ digit, children }: { digit?: number; children: React.ReactNode }) {
    if (digit == null) {
        return <>{children}</>;
    }
    return (
        <span className="relative flex flex-none items-center justify-center">
            <span className="invisible flex items-center">{children}</span>
            <kbd
                data-digit-hint={digit}
                className="pointer-events-none absolute left-1/2 top-1/2 flex h-[15px] min-w-[15px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[4px] bg-accent px-[3px] font-sans text-[10px] font-bold leading-none tabular-nums text-background"
            >
                {digit}
            </kbd>
        </span>
    );
}
