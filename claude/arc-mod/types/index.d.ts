// the mod's $.state contract: the cache miss the band above the prompt is showing, null when none is.

declare module "claude-code" {
    interface PluginState {
        arc: { cacheMiss: string | null };
    }
}
