// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// the run sheet composer's attribute, and the selectors i / Esc find it by (bindings.ts). One constant, so the
// binding cannot name an attribute the composer does not draw again

export const COMPOSER_ATTR = "data-jarvis-composer";
export const COMPOSER_SELECTOR = `[${COMPOSER_ATTR}]`;
export const COMPOSER_FIELDS = `${COMPOSER_SELECTOR} input, ${COMPOSER_SELECTOR} textarea`;
