// the mod's $.state contract: the cache miss the band above the prompt is showing, null when none is; the session's
// /goal the band shows, null when it has none (the shape is goal-core.ts GoalState, spelled out: a contract holds no
// import); and the band's clock, moved on each second while a goal is active.

declare module "claude-code" {
    interface PluginState {
        arc: {
            cacheMiss: string | null;
            goal: {
                phase: "proposed" | "active" | "met" | "stopped";
                condition: string;
                setAt: number;
                checks: { met: boolean; reason: string; at: number }[];
                reason?: string;
                iterations?: number;
                durationMs?: number;
                tokens?: number;
                settledBeforePrompt: boolean;
            } | null;
            goalNow: number;
        };
    }
}
