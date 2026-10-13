// the turn's cache miss in the band above the prompt: the one line the person sees in the terminal.
// register.ts owns the state.
import type { Elements, RenderElement } from "claude-code";

export function drawCacheMiss({ Text }: Pick<Elements["terminal"], "Text">, notice: string): RenderElement {
    return <Text color="warning">{notice}</Text>;
}
