// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/memroots"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wavevault"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

const MetaKey_JarvisProfile = "jarvis:profile"

const globalProfileFileName = "jarvis-profile.json"

// Landing values: an engine run lands its lanes in the project checkout, or on a wave/<runId> branch
// in a worktree of its own. A landing no one chose is a branch, so a run never commits into the checkout
// the human is working in unless asked to.
const (
	Landing_Checkout = "checkout"
	Landing_Branch   = "branch"
)

const (
	DiagnosticMissingReplacement = "missing-replacement"
	DiagnosticMissingDisabled    = "missing-disabled"
)

var DefaultPrinciples = waveobj.PrincipleList{
	{ID: "simple-solutions", Text: "Prefer simple, direct solutions over enterprise over-engineering."},
	{ID: "engineering-principles", Text: "Apply SOLID, KISS, YAGNI, and DRY. Keep a single source of truth."},
	{ID: "measure-first", Text: "Measure before optimizing. Do not abstract for a single implementation."},
	{ID: "boundary-errors", Text: "Handle errors at boundaries and never silently swallow them."},
}

func BuiltinProfile() waveobj.JarvisProfile {
	return waveobj.JarvisProfile{Principles: clonePrinciples(DefaultPrinciples)}
}

// globalProfilePath is the profile's home in the vault, so it syncs with the rest of the vault's config.
func globalProfilePath() string {
	return filepath.Join(memroots.VaultRoot(), wconfig.VaultConfigDir, globalProfileFileName)
}

func LoadGlobalProfile() waveobj.JarvisProfile {
	path := globalProfilePath()
	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("jarvis profile: reading %s: %v (using builtin)", path, err)
		}
		return BuiltinProfile()
	}
	var profile waveobj.JarvisProfile
	if err := json.Unmarshal(data, &profile); err != nil {
		log.Printf("jarvis profile: malformed %s: %v (using builtin)", path, err)
		return BuiltinProfile()
	}
	if err := validatePrincipleItems(profile.Principles); err != nil {
		log.Printf("jarvis profile: invalid principles in %s: %v (using builtin)", path, err)
		return BuiltinProfile()
	}
	return profile
}

// SaveGlobalProfile validates and atomically writes the global profile to jarvis-profile.json in the
// vault's config dir, then pokes vault sync. It is the write counterpart to LoadGlobalProfile; the first save creates the file.
func SaveGlobalProfile(profile waveobj.JarvisProfile) error {
	if err := ValidateGlobalPrinciples(profile.Principles); err != nil {
		return fmt.Errorf("invalid principles: %w", err)
	}
	if err := ValidateLanding(profile.Landing); err != nil {
		return err
	}
	data, err := json.MarshalIndent(profile, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling profile: %w", err)
	}
	if err := writeProfileFile(globalProfilePath(), data); err != nil {
		return err
	}
	wavevault.Poke()
	return nil
}

func writeProfileFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating profile dir: %w", err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("writing profile: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("finalizing profile: %w", err)
	}
	return nil
}

// MigrateGlobalProfile moves a profile left in the config dir into the vault. When the vault already has
// one, both stay: the vault's wins and the local file is never deleted.
func MigrateGlobalProfile() error {
	old := filepath.Join(wavebase.GetWaveConfigDir(), globalProfileFileName)
	data, err := os.ReadFile(old)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("reading %s: %w", old, err)
	}
	dst := globalProfilePath()
	if _, err := os.Stat(dst); err == nil {
		log.Printf("jarvis profile: both %s and %s exist; using the vault's and leaving %s alone", dst, old, old)
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("checking %s: %w", dst, err)
	}
	if err := writeProfileFile(dst, data); err != nil {
		return err
	}
	if err := os.Remove(old); err != nil {
		return fmt.Errorf("removing migrated %s: %w", old, err)
	}
	wavevault.Poke()
	return nil
}

// ValidateLanding accepts the landing values and empty, which means branch.
func ValidateLanding(landing string) error {
	switch landing {
	case "", Landing_Checkout, Landing_Branch:
		return nil
	}
	return fmt.Errorf("unknown landing %q: want %q or %q", landing, Landing_Checkout, Landing_Branch)
}

// EffectiveLanding is where a run lands: its own request, else the profile's, else a branch.
func EffectiveLanding(requested, profile string) string {
	if requested != "" {
		return requested
	}
	if profile != "" {
		return profile
	}
	return Landing_Branch
}

// LandPath is the tree a run's lanes land in and its lead works in: its own wave/<runId> tree when it has
// one, else the project checkout. Lane trees are still made and removed under ProjectPath.
func LandPath(run *waveobj.Run) string {
	if run.LandPath != "" {
		return run.LandPath
	}
	return run.ProjectPath
}

// ValidateGlobalPrinciples is the write path's check. It refuses a principle that repeats an earlier one,
// which the read path (validatePrincipleItems) tolerates and RenderPrinciples drops, so a file saved before
// the refusal still loads.
func ValidateGlobalPrinciples(items waveobj.PrincipleList) error {
	if err := validatePrincipleItems(items); err != nil {
		return err
	}
	return duplicatePrinciple(items)
}

// normalizePrinciple is the text two principles are compared by: case, spacing and trailing punctuation
// are not a difference. Near-duplicates stay the human's to edit.
func normalizePrinciple(s string) string {
	return strings.TrimRight(strings.Join(strings.Fields(strings.ToLower(s)), " "), ".,;:!")
}

func duplicatePrinciple(items waveobj.PrincipleList) error {
	seen := make(map[string]waveobj.Principle, len(items))
	for _, item := range items {
		key := normalizePrinciple(item.Text)
		if earlier, ok := seen[key]; ok {
			return fmt.Errorf("principle %q repeats the earlier principle %q (%q)", item.Text, earlier.Text, earlier.ID)
		}
		seen[key] = item
	}
	return nil
}

func validatePrincipleItems(items waveobj.PrincipleList) error {
	seen := make(map[string]struct{}, len(items))
	for i, item := range items {
		if strings.TrimSpace(item.ID) == "" {
			return fmt.Errorf("principle %d has a blank id", i)
		}
		if strings.TrimSpace(item.Text) == "" {
			return fmt.Errorf("principle %q has blank text", item.ID)
		}
		if _, ok := seen[item.ID]; ok {
			return fmt.Errorf("duplicate principle id %q", item.ID)
		}
		seen[item.ID] = struct{}{}
	}
	return nil
}

// ValidatePrinciplePatch is the write path's check for a project patch: on top of validatePatchItems, the
// principles it resolves to must not repeat one another.
func ValidatePrinciplePatch(global waveobj.PrincipleList, patch *waveobj.PrinciplePatch) error {
	if err := validatePatchItems(global, patch); err != nil {
		return err
	}
	resolved, _ := ResolvePrinciples(global, patch)
	return duplicatePrinciple(resolved)
}

func validatePatchItems(global waveobj.PrincipleList, patch *waveobj.PrinciplePatch) error {
	if err := validatePrincipleItems(global); err != nil {
		return fmt.Errorf("invalid global principles: %w", err)
	}
	if patch == nil {
		return nil
	}
	if _, legacy := patch.LegacyReplacement(); legacy {
		return nil
	}
	globalIDs := make(map[string]struct{}, len(global))
	for _, item := range global {
		globalIDs[item.ID] = struct{}{}
	}
	additionIDs := make(map[string]struct{}, len(patch.Additions))
	for i, item := range patch.Additions {
		if strings.TrimSpace(item.ID) == "" {
			return fmt.Errorf("addition %d has a blank id", i)
		}
		if strings.TrimSpace(item.Text) == "" {
			return fmt.Errorf("addition %q has blank text", item.ID)
		}
		if _, ok := globalIDs[item.ID]; ok {
			return fmt.Errorf("addition id %q collides with a global principle", item.ID)
		}
		if _, ok := additionIDs[item.ID]; ok {
			return fmt.Errorf("duplicate addition id %q", item.ID)
		}
		additionIDs[item.ID] = struct{}{}
	}
	for id, text := range patch.Replacements {
		if strings.TrimSpace(id) == "" {
			return fmt.Errorf("replacement has a blank id")
		}
		if strings.TrimSpace(text) == "" {
			return fmt.Errorf("replacement %q has blank text", id)
		}
	}
	for i, id := range patch.Disabled {
		if strings.TrimSpace(id) == "" {
			return fmt.Errorf("disabled principle %d has a blank id", i)
		}
	}
	return nil
}

func NormalizePrinciplePatch(global waveobj.PrincipleList, patch *waveobj.PrinciplePatch) *waveobj.PrinciplePatch {
	if patch == nil {
		return nil
	}
	if legacy, ok := patch.LegacyReplacement(); ok {
		disabled := make([]string, 0, len(global))
		for _, item := range global {
			disabled = append(disabled, item.ID)
		}
		return &waveobj.PrinciplePatch{
			Additions: []waveobj.Principle{{ID: waveobj.LegacyProjectPrincipleID, Text: legacy}},
			Disabled:  disabled,
		}
	}
	return clonePrinciplePatch(patch)
}

func ResolvePrinciples(global waveobj.PrincipleList, patch *waveobj.PrinciplePatch) (waveobj.PrincipleList, []waveobj.PrincipleDiagnostic) {
	if patch == nil {
		return clonePrinciples(global), nil
	}
	if legacy, ok := patch.LegacyReplacement(); ok {
		return waveobj.PrincipleList{{ID: waveobj.LegacyProjectPrincipleID, Text: legacy}}, nil
	}
	if validatePatchItems(global, patch) != nil {
		return clonePrinciples(global), nil
	}

	globalIDs := make(map[string]struct{}, len(global))
	for _, item := range global {
		globalIDs[item.ID] = struct{}{}
	}
	diagnostics := make([]waveobj.PrincipleDiagnostic, 0)
	missingReplacementIDs := make([]string, 0)
	for id := range patch.Replacements {
		if _, ok := globalIDs[id]; !ok {
			missingReplacementIDs = append(missingReplacementIDs, id)
		}
	}
	sort.Strings(missingReplacementIDs)
	for _, id := range missingReplacementIDs {
		diagnostics = append(diagnostics, waveobj.PrincipleDiagnostic{Code: DiagnosticMissingReplacement, PrincipleID: id})
	}
	disabled := make(map[string]struct{}, len(patch.Disabled))
	for _, id := range patch.Disabled {
		if _, ok := globalIDs[id]; !ok {
			diagnostics = append(diagnostics, waveobj.PrincipleDiagnostic{Code: DiagnosticMissingDisabled, PrincipleID: id})
			continue
		}
		disabled[id] = struct{}{}
	}

	resolved := make(waveobj.PrincipleList, 0, len(global)+len(patch.Additions))
	for _, item := range global {
		if _, ok := disabled[item.ID]; ok {
			continue
		}
		if replacement, ok := patch.Replacements[item.ID]; ok {
			item.Text = replacement
		}
		resolved = append(resolved, item)
	}
	resolved = append(resolved, patch.Additions...)
	return resolved, diagnostics
}

func ResolveProfileWithDiagnostics(global waveobj.JarvisProfile, override *waveobj.ProfileOverride) (waveobj.JarvisProfile, []waveobj.PrincipleDiagnostic) {
	out := global
	var patch *waveobj.PrinciplePatch
	if override != nil {
		patch = override.Principles
		if override.DefaultMode != nil {
			out.DefaultMode = *override.DefaultMode
		}
		if override.Parallelism != nil {
			out.Parallelism = *override.Parallelism
		}
		// the workers setting is one section: naming either half replaces both, so a project can override a
		// global route or Reviewer picks back to Same as lead
		if override.WorkerRoute != nil || override.ReviewerPicks != nil {
			out.WorkerRoute = override.WorkerRoute
			out.ReviewerPicks = override.ReviewerPicks != nil && *override.ReviewerPicks
		}
		if override.ReviewerRoute != nil {
			out.ReviewerRoute = override.ReviewerRoute
		}
		if override.LightReviewerRoute != nil {
			out.LightReviewerRoute = override.LightReviewerRoute
		}
		if override.Landing != nil {
			out.Landing = *override.Landing
		}
		if override.Autonomous != nil {
			out.Autonomous = *override.Autonomous
		}
	}
	principles, diagnostics := ResolvePrinciples(global.Principles, patch)
	out.Principles = principles
	return out, diagnostics
}

func ResolveProfile(global waveobj.JarvisProfile, override *waveobj.ProfileOverride) waveobj.JarvisProfile {
	resolved, _ := ResolveProfileWithDiagnostics(global, override)
	return resolved
}

// ProfileOverrideIsEmpty is the single emptiness rule for a channel override: every section absent, or
// a semantically empty one. Empty clears the stored meta rather than persisting a no-op override, and it
// lives here so the write path and every reader cannot drift on what "no override" means.
func ProfileOverrideIsEmpty(o *waveobj.ProfileOverride) bool {
	if o == nil {
		return true
	}
	patch := o.Principles
	if patch != nil && patch.IsEmpty() {
		patch = nil
	}
	return patch == nil && o.Route == nil && o.DefaultMode == nil &&
		o.Parallelism == nil && o.WorkerRoute == nil && o.ReviewerPicks == nil && o.ReviewerRoute == nil &&
		o.LightReviewerRoute == nil && o.Landing == nil && o.Autonomous == nil
}

func RenderPrinciples(items waveobj.PrincipleList) string {
	if len(items) == 0 {
		return ""
	}
	if len(items) == 1 && (items[0].ID == waveobj.LegacyGlobalPrincipleID || items[0].ID == waveobj.LegacyProjectPrincipleID) {
		return items[0].Text
	}
	lines := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		key := normalizePrinciple(item.Text)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		lines = append(lines, "- "+item.Text)
	}
	return strings.Join(lines, "\n")
}

func OverrideFromMeta(ch *waveobj.Channel) *waveobj.ProfileOverride {
	if ch == nil || !ch.Meta.HasKey(MetaKey_JarvisProfile) {
		return nil
	}
	raw, err := json.Marshal(ch.Meta[MetaKey_JarvisProfile])
	if err != nil {
		log.Printf("jarvis profile: marshaling override meta: %v", err)
		return nil
	}
	var override waveobj.ProfileOverride
	if err := json.Unmarshal(raw, &override); err != nil {
		log.Printf("jarvis profile: bad override meta, ignoring: %v", err)
		return nil
	}
	return &override
}

func clonePrinciples(items waveobj.PrincipleList) waveobj.PrincipleList {
	return append(waveobj.PrincipleList(nil), items...)
}

func clonePrinciplePatch(patch *waveobj.PrinciplePatch) *waveobj.PrinciplePatch {
	if patch == nil {
		return nil
	}
	out := &waveobj.PrinciplePatch{
		Additions: append([]waveobj.Principle(nil), patch.Additions...),
		Disabled:  append([]string(nil), patch.Disabled...),
	}
	if patch.Replacements != nil {
		out.Replacements = make(map[string]string, len(patch.Replacements))
		for id, text := range patch.Replacements {
			out.Replacements[id] = text
		}
	}
	return out
}
