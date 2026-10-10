// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The digit a held modifier jumps to, a small badge on the bottom-right corner of a row's leading mark: Ctrl over the
// rail's surfaces, Alt over the Active list's agents. The mark stays visible, and the badge is absolutely placed, so
// the row does not shift while the key is down. Bottom-right keeps clear of the rail's unread badge (top-right).
export function DigitHint({ digit, children }: { digit?: number; children: React.ReactNode }) {
    if (digit == null) {
        return <>{children}</>;
    }
    return (
        <span className="relative flex flex-none items-center justify-center">
            {children}
            <kbd
                data-digit-hint={digit}
                className="pointer-events-none absolute -bottom-[4px] -right-[6px] flex h-[12px] min-w-[12px] items-center justify-center rounded-[3px] bg-accent px-[2px] font-sans text-[9px] font-bold leading-none tabular-nums text-background"
            >
                {digit}
            </kbd>
        </span>
    );
}
