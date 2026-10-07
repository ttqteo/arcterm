// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package runroute owns the supported run runtimes and the model a route resolves to.
package runroute

import (
	"fmt"
	"regexp"
	"slices"

	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const operatorDefault = "operator default"

// a run persisted before routes existed has no runtime; it was always a claude run
const defaultRuntime = "claude"

var (
	claudeAliasRe   = regexp.MustCompile(`^(opus|sonnet|haiku|fable|best)(\[[0-9]+m\])?$`)
	claudeFullRe    = regexp.MustCompile(`^claude-[a-zA-Z0-9-]+$`)
	providerModelRe = regexp.MustCompile(`^[a-zA-Z0-9_-]+/[a-zA-Z0-9._:+-]+$`)
	agySlugRe       = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]*$`)
)

type Capability struct {
	Runtime       string   `json:"runtime"`
	Model         string   `json:"model,omitempty"` // "" means the runtime's own default model
	ResolvedModel string   `json:"resolvedmodel"`
	Provider      string   `json:"provider,omitempty"`    // catalog metadata, informational
	ContextHint   string   `json:"contexthint,omitempty"` // catalog metadata, informational
	Default       bool     `json:"default,omitempty"`     // catalog metadata: the harness's own default model
	ModelArgs     []string `json:"-"`
}

var runtimeDefaults = []Capability{
	{Runtime: "pi", ResolvedModel: operatorDefault},
	{Runtime: "claude", ResolvedModel: operatorDefault},
	{Runtime: "agy", ResolvedModel: operatorDefault},
}

func Capabilities(runtime string) []Capability {
	capabilities := make([]Capability, 0, len(runtimeDefaults))
	for _, capability := range runtimeDefaults {
		if capability.Runtime != runtime {
			continue
		}
		capabilities = append(capabilities, clone(capability))
	}
	return capabilities
}

func Resolve(pin waveobj.RoutePin) (Capability, error) {
	if pin.Model != "" {
		return resolveModelPin(pin)
	}
	for _, capability := range runtimeDefaults {
		if capability.Runtime == pin.Runtime {
			return clone(capability), nil
		}
	}
	return Capability{}, fmt.Errorf("unsupported route runtime %q", pin.Runtime)
}

func resolveModelPin(pin waveobj.RoutePin) (Capability, error) {
	if pin.Runtime == "" {
		return Capability{}, fmt.Errorf("model route requires a runtime")
	}
	if !modelNamespaceValid(pin.Runtime, pin.Model) {
		return Capability{}, fmt.Errorf("model %q is not a valid %s model id", pin.Model, pin.Runtime)
	}
	return Capability{
		Runtime:       pin.Runtime,
		Model:         pin.Model,
		ResolvedModel: pin.Model,
		ModelArgs:     []string{"--model", pin.Model},
	}, nil
}

// modelNamespaceValid is the hard submit gate. Presence in the catalog is advisory (the harness is
// the ultimate validator at spawn); namespace membership is deterministic and cheap.
func modelNamespaceValid(runtime, model string) bool {
	switch runtime {
	case "claude":
		return claudeAliasRe.MatchString(model) || claudeFullRe.MatchString(model)
	case "pi":
		return providerModelRe.MatchString(model)
	case "agy":
		return agySlugRe.MatchString(model)
	}
	return false
}

// DefaultRuntime names the runtime of a route persisted without one.
func DefaultRuntime(runtime string) string {
	if runtime == "" {
		return defaultRuntime
	}
	return runtime
}

// MigrateTierPin rewrites a pin saved with a tier to the model that tier resolved to before tiers
// were deleted, and clears the tier. Only claude ever mapped cheap and mid to a model; every other
// tier resolved to the runtime default.
func MigrateTierPin(pin waveobj.RoutePin) (waveobj.RoutePin, bool) {
	if pin.Tier == "" {
		return pin, false
	}
	if pin.Model == "" && pin.Runtime == "claude" {
		switch consult.Tier(pin.Tier) {
		case consult.TierCheap:
			pin.Model = consult.CheapModel
		case consult.TierMid:
			pin.Model = consult.MidModel
		}
	}
	pin.Tier = ""
	return pin, true
}

// IsValid reports whether a capability is an unmodified value returned by Resolve. Consumers pass
// capabilities across package boundaries, so this keeps adapters from launching a hand-built route.
func IsValid(capability Capability) bool {
	resolved, err := Resolve(waveobj.RoutePin{Runtime: capability.Runtime, Model: capability.Model})
	return err == nil && resolved.ResolvedModel == capability.ResolvedModel && slices.Equal(resolved.ModelArgs, capability.ModelArgs)
}

func clone(capability Capability) Capability {
	capability.ModelArgs = append([]string(nil), capability.ModelArgs...)
	return capability
}
