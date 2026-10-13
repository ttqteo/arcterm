import react from "@vitejs/plugin-react-swc";
import svgr from "vite-plugin-svgr";
import tsconfigPaths from "vite-tsconfig-paths";
import { configDefaults, defineConfig } from "vitest/config";

export const TEST_EXCLUDES = [
    ...configDefaults.exclude.filter((p) => !p.includes("vitest")),
    "**/{karma,rollup,webpack,vite,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
    "**/.claude/**",
    "**/.worktrees/**",
    "**/.waveterm/worktrees/**",
    // gitignored scratch (mockups, mod probes) whose tests need deps the repo does not install
    "**/.superpowers/**",
];

export default defineConfig({
    plugins: [
        tsconfigPaths(),
        svgr({
            svgrOptions: { exportType: "default", ref: true, svgo: false, titleProp: true },
            include: "**/*.svg",
        }),
        react({}),
    ],
    css: {
        preprocessorOptions: {
            scss: {
                silenceDeprecations: ["mixed-decls"],
            },
        },
    },
    test: {
        // git worktrees under .claude/, .worktrees/, or .waveterm/worktrees/ carry a full copy of the suite;
        // vitest's default glob walks the repo root, so without this it runs every sibling session's tests
        // too (a stale copy of a just-edited file produces silently misleading green runs).
        exclude: TEST_EXCLUDES,
        // the suite is bound by starting workers and loading modules, not by the tests; a thread starts faster than
        // a forked process on windows: ~27 s against ~35 s for the whole suite
        pool: "threads",
        reporters: ["verbose", "junit"],
        outputFile: {
            junit: "test-results.xml",
        },
        coverage: {
            provider: "istanbul",
            reporter: ["lcov"],
            reportsDirectory: "./coverage",
        },
        typecheck: {
            tsconfig: "tsconfig.json",
        },
    },
});
