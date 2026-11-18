// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"errors"
)

// errTakeNotBuilt is what the take and release stubs answer until the take is built.
var errTakeNotBuilt = errors.New("not built yet")

// remoteTake is Deps.Take: it hands the tab to the phone, or returns an error wrapping ErrRefused.
// A stub: it takes nothing yet.
func remoteTake(_ context.Context, _ string) error { return errTakeNotBuilt }

// remoteRelease is Deps.Release: it ends a take the owner never acted on. A stub: it releases nothing yet.
func remoteRelease(_ context.Context, _ string) error { return errTakeNotBuilt }

// handMarkActed records that the owner acted on a handed-over tab from the phone, so leaving the agent view
// no longer releases it. remoteAct calls it after every action that succeeds. A stub: it records nothing yet.
func handMarkActed(_ string) {}
