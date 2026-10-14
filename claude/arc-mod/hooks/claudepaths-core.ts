// where claude keeps a project's files, worked out from the session alone. kept free of the engine so vitest can
// run it. the hook events that carry these paths are the classic ones, and an org that manages Claude Code (Team,
// Enterprise) passes them over for a plugin a person installs

// claude's config dir: CLAUDE_CONFIG_DIR, else ~/.claude; null when no home is known
export function claudeConfigDir(env: { configDir?: string; home?: string }): string | null {
    if (env.configDir) {
        return env.configDir;
    }
    return env.home ? `${env.home.replace(/[\\/]+$/, "")}/.claude` : null;
}

// the project's folder: <config dir>/projects/<the session's starting cwd, every non-alphanumeric a dash>
export function projectDir(configDir: string, cwd: string): string {
    return `${configDir.replace(/[\\/]+$/, "")}/projects/${cwd.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

// the session's transcript
export function transcriptFile(configDir: string, cwd: string, sessionId: string): string {
    return `${projectDir(configDir, cwd)}/${sessionId}.jsonl`;
}

// the project's auto-memory dir. an autoMemoryDirectory setting moves it, and a reader then finds no MEMORY.md
export function memoryDir(configDir: string, cwd: string): string {
    return `${projectDir(configDir, cwd)}/memory`;
}
