// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/memroots"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// the three entry points wshserver calls

func ListProjects() ([]wshrpc.MemHygieneProject, error) {
	return List(memroots.RegistryProjects())
}

func StartCheck(project string) error {
	return fmt.Errorf("memory hygiene: check of %s is not wired yet", project)
}

func Decide(project, changeID, verdict string) (*wshrpc.MemHygieneProject, error) {
	return nil, fmt.Errorf("memory hygiene: %s on change %s of %s is not wired yet", verdict, changeID, project)
}
