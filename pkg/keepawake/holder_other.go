// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !darwin

package keepawake

import "context"

// Holder holds nothing off the Mac: the hold is macOS only.
type Holder struct{}

func (h *Holder) Set(on bool) error { return nil }

func ReadBattery(context.Context) Battery { return Battery{Pct: -1} }
