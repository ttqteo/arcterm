// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import "errors"

// SetCanvasLink writes the version link of the canvas in dir to its canvas.json: replaces is the topic of the older
// canvas it replaces ("" removes the link) and notReplaces the topics the person said it does not replace (empty
// removes the key). Both are set whole; the caller computes them.
func SetCanvasLink(projects []string, dir, replaces string, notReplaces []string) error {
	return errors.New("not implemented")
}
