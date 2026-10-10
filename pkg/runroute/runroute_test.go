package runroute

import (
	"slices"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestResolveRuntimeDefaults(t *testing.T) {
	for _, runtime := range []string{"claude", "pi", "agy", "codex"} {
		got, err := Resolve(waveobj.RoutePin{Runtime: runtime})
		if err != nil {
			t.Fatalf("%s default: %v", runtime, err)
		}
		if got.Runtime != runtime || got.Model != "" || got.ResolvedModel != operatorDefault || got.ModelArgs != nil {
			t.Fatalf("%s default = %+v", runtime, got)
		}
	}
}

func TestResolveRejectsUnsupportedRuntimes(t *testing.T) {
	for _, pin := range []waveobj.RoutePin{
		{Runtime: "opencode"},
		{Runtime: "openrouter"},
		{Runtime: ""},
		{Runtime: "opencode", Model: "openai/gpt-5.4"},
		{Runtime: "", Model: "sonnet"},
	} {
		if _, err := Resolve(pin); err == nil {
			t.Errorf("Resolve(%+v) accepted an unsupported route", pin)
		}
	}
}

func TestResolveCodexModel(t *testing.T) {
	got, err := Resolve(waveobj.RoutePin{Runtime: "codex", Model: "gpt-5.5"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Runtime != "codex" || got.Model != "gpt-5.5" || got.ResolvedModel != "gpt-5.5" || !slices.Equal(got.ModelArgs, []string{"--model", "gpt-5.5"}) {
		t.Fatalf("codex gpt-5.5 = %+v", got)
	}
	for _, model := range []string{"o3", "gpt-5.1-codex-max", "gpt-5.3-codex-spark"} {
		if _, err := Resolve(waveobj.RoutePin{Runtime: "codex", Model: model}); err != nil {
			t.Errorf("codex %q refused: %v", model, err)
		}
	}
	for _, model := range []string{"gpt 5", "a;b", "openai/gpt-5.5", "-gpt", ".gpt", "a'b", "a\"b", "$(x)", "a|b", "a&b", "a`b"} {
		if _, err := Resolve(waveobj.RoutePin{Runtime: "codex", Model: model}); err == nil {
			t.Errorf("codex %q accepted", model)
		}
	}
}

func TestResolveIgnoresStaleTier(t *testing.T) {
	got, err := Resolve(waveobj.RoutePin{Runtime: "claude", Tier: "cheap"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Model != "" || got.ModelArgs != nil {
		t.Fatalf("a tier must not select a model any more: %+v", got)
	}
}

func TestCapabilitiesReturnsIndependentSlices(t *testing.T) {
	resolved, err := Resolve(waveobj.RoutePin{Runtime: "claude", Model: "haiku"})
	if err != nil {
		t.Fatal(err)
	}
	resolved.ModelArgs[1] = "mutated"
	again, err := Resolve(waveobj.RoutePin{Runtime: "claude", Model: "haiku"})
	if err != nil {
		t.Fatal(err)
	}
	if again.ModelArgs[1] != "haiku" {
		t.Fatalf("resolved args share storage: %+v", again.ModelArgs)
	}
	caps := Capabilities("pi")
	caps[0].ResolvedModel = "mutated"
	if Capabilities("pi")[0].ResolvedModel != operatorDefault {
		t.Fatal("capabilities share storage with the default table")
	}
}

func TestDefaultRuntime(t *testing.T) {
	if DefaultRuntime("") != "claude" || DefaultRuntime("pi") != "pi" {
		t.Fatal("empty runtime must default to claude and a set runtime must pass through")
	}
}

func TestMigrateTierPin(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   waveobj.RoutePin
		want waveobj.RoutePin
	}{
		{"claude cheap", waveobj.RoutePin{Runtime: "claude", Tier: "cheap"}, waveobj.RoutePin{Runtime: "claude", Model: consult.CheapModel}},
		{"claude mid", waveobj.RoutePin{Runtime: "claude", Tier: "mid"}, waveobj.RoutePin{Runtime: "claude", Model: consult.MidModel}},
		{"claude capable", waveobj.RoutePin{Runtime: "claude", Tier: "capable"}, waveobj.RoutePin{Runtime: "claude"}},
		{"pi cheap", waveobj.RoutePin{Runtime: "pi", Tier: "cheap"}, waveobj.RoutePin{Runtime: "pi"}},
		{"unknown tier", waveobj.RoutePin{Runtime: "claude", Tier: "strong"}, waveobj.RoutePin{Runtime: "claude"}},
		{"model kept", waveobj.RoutePin{Runtime: "claude", Tier: "cheap", Model: "opus"}, waveobj.RoutePin{Runtime: "claude", Model: "opus"}},
	} {
		got, changed := MigrateTierPin(tc.in)
		if !changed || got != tc.want {
			t.Errorf("%s: MigrateTierPin(%+v) = %+v, %v; want %+v, true", tc.name, tc.in, got, changed, tc.want)
		}
		if _, again := MigrateTierPin(got); again {
			t.Errorf("%s: a migrated pin must not migrate again", tc.name)
		}
	}
	untouched := waveobj.RoutePin{Runtime: "pi", Model: "opencode/deepseek-v4-pro"}
	if got, changed := MigrateTierPin(untouched); changed || got != untouched {
		t.Fatalf("a tier-free pin changed: %+v", got)
	}
}

func TestResolveModelPinClaudeAlias(t *testing.T) {
	cap, err := Resolve(waveobj.RoutePin{Runtime: "claude", Model: "opus[1m]"})
	if err != nil {
		t.Fatal(err)
	}
	if cap.ResolvedModel != "opus[1m]" || !slices.Equal(cap.ModelArgs, []string{"--model", "opus[1m]"}) {
		t.Fatalf("claude alias pin resolved wrong: %+v", cap)
	}
}

func TestResolveModelPinPiProviderID(t *testing.T) {
	cap, err := Resolve(waveobj.RoutePin{Runtime: "pi", Model: "opencode/deepseek-v4-pro"})
	if err != nil {
		t.Fatal(err)
	}
	if cap.Model != "opencode/deepseek-v4-pro" || cap.ResolvedModel != "opencode/deepseek-v4-pro" {
		t.Fatalf("pi provider pin resolved wrong: %+v", cap)
	}
	if !slices.Equal(cap.ModelArgs, []string{"--model", "opencode/deepseek-v4-pro"}) {
		t.Fatalf("pi args wrong: %+v", cap.ModelArgs)
	}
}

func TestResolveRejectsCrossRuntimeNamespace(t *testing.T) {
	for _, pin := range []waveobj.RoutePin{
		{Runtime: "claude", Model: "gpt-5.4"},
		{Runtime: "claude", Model: "opencode/deepseek-v4-pro"},
		{Runtime: "pi", Model: "has space/deepseek"},
	} {
		if _, err := Resolve(pin); err == nil {
			t.Errorf("expected reject for %+v", pin)
		}
	}
}

func TestIsValidModelCapability(t *testing.T) {
	cap, err := Resolve(waveobj.RoutePin{Runtime: "pi", Model: "opencode/deepseek-v4-flash"})
	if err != nil {
		t.Fatal(err)
	}
	if !IsValid(cap) {
		t.Fatal("resolved model capability must be valid")
	}
	forged := cap
	forged.ModelArgs = []string{"--model", "not-the-resolved-model"}
	if IsValid(forged) {
		t.Fatal("forged ModelArgs must be rejected")
	}
}

// pi's id space is provider-namespaced: a bare id means "whichever authenticated provider serves it",
// which pi refuses to guess at spawn. Wave must not be able to represent that route at all.
func TestResolveRejectsBarePiModel(t *testing.T) {
	for _, model := range []string{"deepseek-v4-pro", "deepseek-v4-flash", "claude-opus-4-8"} {
		if _, err := Resolve(waveobj.RoutePin{Runtime: "pi", Model: model}); err == nil {
			t.Errorf("Resolve(pi, %q) succeeded; bare ids are ambiguous across providers", model)
		}
	}
}

func TestResolveModelPinAgySlug(t *testing.T) {
	cap, err := Resolve(waveobj.RoutePin{Runtime: "agy", Model: "gemini-3.8-flash-high"})
	if err != nil {
		t.Fatal(err)
	}
	if cap.Model != "gemini-3.8-flash-high" || !slices.Equal(cap.ModelArgs, []string{"--model", "gemini-3.8-flash-high"}) {
		t.Fatalf("agy slug pin resolved wrong: %+v", cap)
	}
	if !IsValid(cap) {
		t.Fatal("resolved agy capability must be valid")
	}
}

func TestModelNamespaceAgyRejectsOtherNamespaces(t *testing.T) {
	for _, model := range []string{"openai/gpt-5", "Gemini 3", "Gemini-3", "-flash", "has space"} {
		if modelNamespaceValid("agy", model) {
			t.Errorf("agy accepted %q", model)
		}
		if _, err := Resolve(waveobj.RoutePin{Runtime: "agy", Model: model}); err == nil {
			t.Errorf("Resolve(agy, %q) succeeded", model)
		}
	}
}
