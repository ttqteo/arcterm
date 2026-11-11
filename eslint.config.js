// @ts-check

import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const tsconfigRootDir = path.dirname(fileURLToPath(new URL(import.meta.url)));

export default [
    {
        languageOptions: {
            parserOptions: {
                tsconfigRootDir,
            },
        },
    },

    {
        ignores: [
            "**/node_modules/**",
            "**/dist/**",
            "**/build/**",
        ],
    },

    // no parserOptions.project: no rule here reads types (tseslint's recommended set, not recommendedTypeChecked),
    // and a project made every eslint run build the whole frontend's TypeScript program first, one file included:
    // 862 MB and 36 s for one file against 229 MB and 1 s without, and 40 files ran out of heap (2026-11-11). Add it
    // back only with a rule that needs it.

    eslint.configs.recommended,
    ...tseslint.configs.recommended,

    {
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
        },
    },

    {
        files: ["**/*.cjs", "eslint.config.js"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },

    // the build and test scripts run on Node; the CDP scenarios also hand functions to the page they drive
    {
        files: ["scripts/**/*.{js,mjs}"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    {
        files: ["scripts/cdp/**/*.{js,mjs}"],
        languageOptions: {
            globals: {
                ...globals.browser,
            },
        },
    },

    {
        files: ["**/*.js", "**/*.cjs"],
        rules: {
            "@typescript-eslint/no-require-imports": "off",
        },
    },

    {
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^(_[a-zA-Z0-9_]*|e|get)$",
                    varsIgnorePattern: "^(_[a-zA-Z0-9_]*|dlog|e)$",
                    caughtErrorsIgnorePattern: "^(_[a-zA-Z0-9_]*|e)$",
                },
            ],
            "prefer-const": "warn",
            "no-empty": "warn",
        },
    },

    {
        files: ["frontend/app/store/services.ts"],
        rules: {
            "@typescript-eslint/no-unused-vars": "off",
            "prefer-rest-params": "off",
        },
    },

    eslintConfigPrettier,
];
