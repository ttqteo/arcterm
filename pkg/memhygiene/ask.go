// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import "fmt"

// StartAsk starts a one-memory judge call ("Ask an agent") on the Review changeID of project and
// returns at once; the answer lands in the project's state.
func StartAsk(project, changeID string) error {
	return fmt.Errorf("memory hygiene: ask an agent is not built yet")
}
