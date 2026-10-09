// frontend/app/view/agents/gitstatepanels.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The two repository states that take over the whole Diff surface. They are deliberately different
// screens: "not a repository" is a calm fact about the source you picked, while "the read failed" is
// a fault worth acting on, so it carries the failing command, its exit code, stderr verbatim, and a
// retry. Collapsing them into one banner is the failure mode the design brief called out.

import { cn, fireAndForget } from "@/util/util";
import { CircleAlert, Copy, Folder, X } from "lucide-react";
import type { ReactNode } from "react";
import { explainSyncFailure } from "./syncstate";

// -1 means the failure was not an exit status at all (git missing, a timeout, a dropped socket).
// Showing "no exit code" beats printing -1 as though git had returned it.
function exitLabel(failure: GitFailure): string {
    return failure.exitcode < 0 ? "no exit code" : `exit ${failure.exitcode}`;
}

// The one strip that sits under the subject row while the panes stay put: a failed fetch and the
// restore notice share it, so they differ only in tone.
export function SurfaceBanner({
    tone,
    icon,
    children,
    action,
    onDismiss,
    stacked,
    className,
    ...rest
}: {
    tone: "error" | "neutral";
    icon: ReactNode;
    children: ReactNode;
    // `attrs` marks the button for a test or a script
    action?: { label: string; onClick: () => void; attrs?: { [data: `data-${string}`]: boolean } };
    onDismiss: () => void;
    // the text in a column with the action under it, for a strip too narrow to hold both on one line (the Diff panel's)
    stacked?: boolean;
    // laid over the strip's own margins and alignment
    className?: string;
} & { [data: `data-${string}`]: boolean | string }) {
    const actionButton = action ? (
        <button
            {...action.attrs}
            onClick={action.onClick}
            className={cn(
                "flex-none rounded-[6px] border px-[9px] py-[3px] text-[11.5px] font-semibold",
                tone === "error"
                    ? "border-error/40 text-error hover:bg-error/12"
                    : "border-edge-mid text-ink-mid hover:border-edge-strong hover:text-foreground"
            )}
        >
            {action.label}
        </button>
    ) : null;
    return (
        <div
            {...rest}
            className={cn(
                "mx-[18px] mb-[10px] flex flex-none items-center gap-[10px] rounded-[9px] border px-[12px] py-[8px]",
                tone === "error" ? "border-error/25 bg-error/12" : "border-edge-mid bg-surface",
                stacked && "items-start",
                className
            )}
        >
            <span
                className={cn(
                    "flex flex-none",
                    stacked && "mt-[1px]",
                    tone === "error" ? "text-error" : "text-ink-mid"
                )}
            >
                {icon}
            </span>
            {stacked ? (
                <div className="flex min-w-0 flex-1 flex-col items-start gap-[6px] text-[12px]">
                    {children}
                    {actionButton}
                </div>
            ) : (
                <>
                    <div className="flex min-w-0 flex-1 items-center gap-[8px] text-[12px]">{children}</div>
                    {actionButton}
                </>
            )}
            <button
                onClick={onDismiss}
                title="Dismiss"
                aria-label="Dismiss"
                className="flex flex-none text-muted hover:text-foreground"
            >
                <X size={14} />
            </button>
        </div>
    );
}

export function NotARepoPanel({ path, onChooseSource }: { path: string; onChooseSource: () => void }) {
    return (
        <div data-not-a-repo className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[10px] px-[40px]">
            <Folder size={26} className="text-muted" />
            <div className="text-[14px] font-semibold text-ink-hi">This folder isn’t a Git repository</div>
            <div className="max-w-[560px] select-text truncate text-[11px] text-muted">{path}</div>
            <div className="max-w-[520px] text-center text-[12.5px] leading-[1.6] text-ink-mid">
                There’s no history to show here. Pick another agent or project.
            </div>
            <button
                onClick={onChooseSource}
                className="mt-[4px] rounded-[7px] border border-edge-mid bg-surface-raised px-[12px] py-[6px] text-[12px] font-semibold text-ink-hi hover:border-edge-strong"
            >
                Choose a source
            </button>
        </div>
    );
}

// A git command that failed WITHOUT invalidating what is on screen — a fetch, so far. The panel below
// takes over the surface because a failed read leaves nothing to show; a failed fetch leaves the
// comparison intact and merely not freshened, and blanking the screen would throw that away. Same
// words from git, a banner instead of a takeover.
export function GitFailureNotice({
    failure,
    onRetry,
    onDismiss,
}: {
    failure: GitFailure;
    onRetry: () => void;
    onDismiss: () => void;
}) {
    return (
        <SurfaceBanner
            data-git-failure-notice
            tone="error"
            icon={<CircleAlert size={14} />}
            action={{ label: "Retry", onClick: onRetry }}
            onDismiss={onDismiss}
        >
            <span className="flex-none font-semibold text-error">Fetch failed</span>
            <span className="flex-none text-ink-mid">· showing refs as of the last fetch</span>
            <span
                // one line of what can be several; the full text is a hover away rather than cut off
                title={failure.stderr || undefined}
                className="min-w-0 flex-1 select-text truncate font-mono text-[11px] text-muted"
            >
                {failure.stderr || exitLabel(failure)}
            </span>
        </SurfaceBanner>
    );
}

// A Pull or Push git refused, under the Diff panel's top bar. Not GitFailureNotice: that one is about a fetch ("showing refs
// as of the last fetch") and offers a Retry, while a refused pull is settled by what the person does next (merge or rebase
// in a terminal), so its action opens one in the worktree. The sentence is `explainSyncFailure`'s, when git's words are one
// a person can act on; git's own follow, cut to a line with the whole text a hover away.
export function SyncFailureNotice({
    kind,
    failure,
    branch,
    upstream,
    onOpenTerminal,
    onDismiss,
}: {
    kind: "pull" | "push";
    failure: GitFailure;
    branch: string;
    upstream: string;
    onOpenTerminal: () => void;
    onDismiss: () => void;
}) {
    const sentence = explainSyncFailure(kind, failure, branch, upstream);
    return (
        <SurfaceBanner
            data-sync-failure
            data-sync-failure-kind={kind}
            tone="error"
            stacked
            className="mx-[8px] mb-0 mt-[8px]"
            icon={<CircleAlert size={14} />}
            action={{
                label: "Open a terminal here",
                onClick: onOpenTerminal,
                attrs: { "data-sync-open-terminal": true },
            }}
            onDismiss={onDismiss}
        >
            <span className="font-semibold text-error">{kind === "pull" ? "Pull failed" : "Push failed"}</span>
            {sentence ? <span className="leading-[1.5] text-ink-hi">{sentence}</span> : null}
            <span className="max-w-full truncate font-mono text-[10.5px] text-muted">
                {failure.command} · {exitLabel(failure)}
            </span>
            {failure.stderr ? (
                <span
                    title={failure.stderr}
                    className="max-w-full select-text truncate font-mono text-[10.5px] text-ink-mid"
                >
                    {failure.stderr}
                </span>
            ) : null}
        </SurfaceBanner>
    );
}

export function GitFailurePanel({ failure, onRetry }: { failure: GitFailure; onRetry: () => void }) {
    const copy = () =>
        fireAndForget(() => navigator.clipboard.writeText(`${failure.command}\n\n${failure.stderr ?? ""}`));
    return (
        <div data-git-failure className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[12px] px-[40px]">
            <CircleAlert size={26} className="text-error" />
            <div className="text-[14px] font-semibold text-ink-hi">Couldn’t read this repository</div>
            <div className="max-w-[560px] text-center text-[12.5px] leading-[1.6] text-ink-mid">
                Git stopped with an error. Nothing was changed, so retrying is safe.
            </div>
            <div className="w-full max-w-[720px] rounded-[8px] border border-edge-mid bg-surface-code">
                <div className="flex items-center gap-[8px] px-[12px] py-[9px]">
                    <span className="min-w-0 flex-1 select-text truncate font-mono text-[11.5px] text-ink-mid">
                        {failure.command}
                    </span>
                    <span className="flex-none rounded-[5px] border border-error/25 bg-error/12 px-[7px] py-[2px] text-[10.5px] font-semibold tabular-nums text-error">
                        {exitLabel(failure)}
                    </span>
                    <button
                        onClick={copy}
                        title="Copy command and output"
                        aria-label="Copy command and output"
                        className="flex flex-none text-muted hover:text-foreground"
                    >
                        <Copy size={13} />
                    </button>
                </div>
                {failure.stderr ? (
                    <pre className="max-h-[220px] select-text overflow-auto whitespace-pre-wrap break-words border-t border-edge-faint px-[12px] py-[10px] font-mono text-[11.5px] leading-[1.5] text-ink-mid">
                        {failure.stderr}
                    </pre>
                ) : null}
            </div>
            <button
                data-git-failure-retry
                onClick={onRetry}
                className="rounded-[7px] bg-accent px-[14px] py-[6px] text-[12px] font-semibold text-background hover:bg-accenthover"
            >
                Retry
            </button>
        </div>
    );
}
