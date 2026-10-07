// Pure preview-layout logic for the answer surface, mirroring rpiv's rule: previews are
// single-select only, and the panel shows the focused option's preview.
import type { AgentAskQuestion } from "./agentsviewmodel";

export function previewMode(question: AgentAskQuestion): boolean {
    if (question.multiSelect) {
        return false;
    }
    return (question.options ?? []).some((o) => !!o.preview);
}

export function activePreview(question: AgentAskQuestion, focusIndex: number): string | undefined {
    const opts = question.options ?? [];
    if (opts.length === 0) {
        return undefined;
    }
    // out-of-range focus (defensive; the component only sets valid option indices)
    // defaults to the first option so the panel stays populated.
    if (focusIndex < 0 || focusIndex >= opts.length) {
        return opts[0]?.preview || undefined;
    }
    return opts[focusIndex]?.preview || undefined;
}

// The preview as the panel prints it: monospace, every line and space kept, like Claude Code's own
// preview box, which is what the author drew it for. A preview that is one fenced block loses its fences.
export function previewText(preview: string): string {
    const text = preview.replace(/\s+$/, "").replace(/^\s*\n/, "");
    const fenced = /^```[^\n`]*\n([\s\S]*?)\n```$/.exec(text.trim());
    return fenced ? fenced[1] : text;
}
