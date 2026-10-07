package claudeaccount

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// memSecrets swaps the secretstore for a map
func useTemp(t *testing.T) map[string]string {
	t.Helper()
	dir := t.TempDir()
	secrets := map[string]string{}
	oldPath, oldSet, oldGet, oldDel := storePath, setSecret, getSecret, deleteSecret
	storePath = func() string { return filepath.Join(dir, "claude-accounts.json") }
	setSecret = func(n, v string) error { secrets[n] = v; return nil }
	getSecret = func(n string) (string, bool, error) { v, ok := secrets[n]; return v, ok, nil }
	deleteSecret = func(n string) error { delete(secrets, n); return nil }
	t.Cleanup(func() { storePath, setSecret, getSecret, deleteSecret = oldPath, oldSet, oldGet, oldDel })
	return secrets
}

func TestAddListRenameRemove(t *testing.T) {
	secrets := useTemp(t)
	a, err := Add("Công ty", "sk-ant-oat01-abc", "")
	if err != nil {
		t.Fatal(err)
	}
	if secrets[secretName(a.Id)] != "sk-ant-oat01-abc" {
		t.Fatalf("token not stored under %s", secretName(a.Id))
	}
	if err := Rename(a.Id, "Work"); err != nil {
		t.Fatal(err)
	}
	list, _ := List()
	if len(list) != 1 || list[0].Label != "Work" {
		t.Fatalf("list = %+v", list)
	}
	if err := Remove(a.Id); err != nil {
		t.Fatal(err)
	}
	list, _ = List()
	if len(list) != 0 || len(secrets) != 0 {
		t.Fatalf("after remove: list %+v secrets %v", list, secrets)
	}
}

func TestAddRejectsNonOAuthToken(t *testing.T) {
	useTemp(t)
	if _, err := Add("x", "sk-ant-api03-nope", ""); err == nil {
		t.Fatal("want an error for a non-setup-token value")
	}
}

func TestAddStoresATrimmedLowercasedEmail(t *testing.T) {
	useTemp(t)
	a, err := Add("Mozox", "sk-ant-oat01-eee", "  Mozox@Example.COM ")
	if err != nil {
		t.Fatal(err)
	}
	if a.Email != "mozox@example.com" {
		t.Fatalf("returned email = %q", a.Email)
	}
	list, _ := List()
	if len(list) != 1 || list[0].Email != "mozox@example.com" {
		t.Fatalf("listed email = %+v", list)
	}
}

func TestSetEmailSetsNormalizesAndClears(t *testing.T) {
	useTemp(t)
	a, _ := Add("A", "sk-ant-oat01-aaa", "")
	if a.Email != "" {
		t.Fatalf("email without one given = %q", a.Email)
	}
	if err := SetEmail(a.Id, " Me@Host.io "); err != nil {
		t.Fatal(err)
	}
	if list, _ := List(); list[0].Email != "me@host.io" {
		t.Fatalf("after set: %+v", list)
	}
	if err := SetEmail(a.Id, ""); err != nil {
		t.Fatal(err)
	}
	if list, _ := List(); list[0].Email != "" {
		t.Fatalf("after clear: %+v", list)
	}
	raw, _ := os.ReadFile(storePath())
	if strings.Contains(string(raw), "email") {
		t.Fatalf("a cleared email should leave the file (omitempty): %s", raw)
	}
}

func TestSetEmailUnknownAccount(t *testing.T) {
	useTemp(t)
	if err := SetEmail("a00000000", "x@y.z"); err == nil {
		t.Fatal("want an error for an unknown account")
	}
}

func TestApplyEnvSetsAndRestoresInherited(t *testing.T) {
	useTemp(t)
	t.Setenv(tokenVar, "inherited")
	os.Unsetenv(accountVar)
	captureInherited()
	a, _ := Add("B", "sk-ant-oat01-bbb", "")

	if got := ApplyEnv(a.Id); got != a.Id {
		t.Fatalf("applied %q", got)
	}
	if os.Getenv(tokenVar) != "sk-ant-oat01-bbb" || os.Getenv(accountVar) != a.Id {
		t.Fatal("active account not in env")
	}
	if got := ApplyEnv(""); got != "" {
		t.Fatalf("default applied %q", got)
	}
	if os.Getenv(tokenVar) != "inherited" {
		t.Fatal("inherited token not restored")
	}
	if _, set := os.LookupEnv(accountVar); set {
		t.Fatal("account var should be unset again")
	}
}

// what wavesrv spawns (shellexec, consult, run workers) starts from os.Environ(): a child started after
// ApplyEnv must see the account, and must not after a switch back to Default
func TestApplyEnvReachesChildProcess(t *testing.T) {
	if os.Getenv("CLAUDEACCOUNT_HELPER") == "1" {
		fmt.Print(os.Getenv(accountVar))
		os.Exit(0)
	}
	useTemp(t)
	os.Unsetenv(accountVar)
	captureInherited()
	a, _ := Add("C", "sk-ant-oat01-ccc", "")
	child := func() string {
		cmd := exec.Command(os.Args[0], "-test.run=^TestApplyEnvReachesChildProcess$")
		cmd.Env = append(os.Environ(), "CLAUDEACCOUNT_HELPER=1")
		out, err := cmd.Output()
		if err != nil {
			t.Fatal(err)
		}
		return string(out)
	}
	ApplyEnv(a.Id)
	if got := child(); got != a.Id {
		t.Fatalf("child saw %q, want %q", got, a.Id)
	}
	ApplyEnv("")
	if got := child(); got != "" {
		t.Fatalf("child saw %q after Default", got)
	}
}

func TestApplyEnvUnknownAccountFallsBackToDefault(t *testing.T) {
	useTemp(t)
	os.Unsetenv(tokenVar)
	captureInherited()
	if got := ApplyEnv("a00000000"); got != "" {
		t.Fatalf("applied %q for an account with no token", got)
	}
	if _, set := os.LookupEnv(tokenVar); set {
		t.Fatal("token var should stay unset")
	}
}
