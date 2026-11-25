// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitaccount

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// The list in git-accounts.json is the only source: every change rewrites it and then renders arcterm's block in
// ~/.gitconfig and each ~/.gitconfig-<login> from it (gitconfig.go), so nothing is edited line by line and the
// files on disk cannot drift from the list.
type account struct {
	Login string   `json:"login"`
	Name  string   `json:"name"`
	Email string   `json:"email"`
	Roots []string `json:"roots"`
}

type config struct {
	DefaultLogin string    `json:"defaultlogin"`
	Accounts     []account `json:"accounts"`
	// The github.com helpers Fix saved. nil: Fix has not run, the block does not reset helpers. Empty but not nil:
	// the block resets them and there is nothing to put back.
	GithubHelpers []string `json:"githubhelpers"`
}

// swapped by tests
var (
	storePath = func() string { return filepath.Join(wavebase.GetWaveDataDir(), "git-accounts.json") }
	backupDir = func() string { return filepath.Join(wavebase.GetWaveDataDir(), "git-accounts-backup") }
	osHelper  = defaultOSHelper()
	githubAPI = "https://api.github.com"
)

// mu is held around every write, never around a network call.
var mu sync.Mutex

func defaultOSHelper() string {
	switch runtime.GOOS {
	case "darwin":
		return "osxkeychain"
	case "windows":
		return "manager"
	}
	return "libsecret"
}

var loginRe = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`)

func checkLogin(login string) error {
	if !loginRe.MatchString(login) {
		return fmt.Errorf("%q is not a GitHub login", login)
	}
	return nil
}

func checkLine(what, s string) error {
	if strings.ContainsAny(s, "\r\n\x00") {
		return fmt.Errorf("%s must be one line", what)
	}
	return nil
}

func checkEmail(email string) error {
	if email == "" || strings.ContainsAny(email, " \t\r\n\x00") {
		return errors.New("a commit email is required")
	}
	return nil
}

func load() (config, error) {
	raw, err := os.ReadFile(storePath())
	if errors.Is(err, os.ErrNotExist) {
		return config{}, nil
	}
	if err != nil {
		return config{}, err
	}
	var cfg config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return config{}, fmt.Errorf("reading %s: %w", storePath(), err)
	}
	return cfg, nil
}

func (c config) find(login string) int {
	for i, a := range c.Accounts {
		if strings.EqualFold(a.Login, login) {
			return i
		}
	}
	return -1
}

// clone copies the slices an edit touches, so a failed apply leaves the loaded value as it was.
func (c config) clone() config {
	out := c
	out.Accounts = make([]account, len(c.Accounts))
	for i, a := range c.Accounts {
		a.Roots = append([]string{}, a.Roots...)
		out.Accounts[i] = a
	}
	return out
}

// apply saves cfg and renders it. A render that fails puts the old list back, so the list and the files stay one story.
// b is the operation's backup folder; nil makes one of its own.
func apply(old, cfg config, b *backup) error {
	if err := writeJSON(storePath(), cfg); err != nil {
		return fmt.Errorf("saving the account list: %w", err)
	}
	if b == nil {
		b = &backup{}
		defer b.prune()
	}
	if err := render(cfg, b); err != nil {
		if rerr := writeJSON(storePath(), old); rerr != nil {
			log.Printf("[gitaccount] could not put the old account list back after a failed render: %v", rerr)
		}
		return err
	}
	return nil
}

func writeJSON(path string, v any) error {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return writeFileAtomic(path, append(raw, '\n'), 0o600)
}

func toData(a account) wshrpc.GitAccountData {
	roots := a.Roots
	if roots == nil {
		roots = []string{}
	}
	return wshrpc.GitAccountData{Login: a.Login, Name: a.Name, Email: a.Email, Roots: roots}
}

// List is local and fast: the list, the default login and what git itself would use outside every root.
func List() (*wshrpc.GitAccountListRtnData, error) {
	cfg, err := load()
	if err != nil {
		return nil, err
	}
	rtn := &wshrpc.GitAccountListRtnData{Accounts: make([]wshrpc.GitAccountData, 0, len(cfg.Accounts)), DefaultLogin: cfg.DefaultLogin}
	for _, a := range cfg.Accounts {
		rtn.Accounts = append(rtn.Accounts, toData(a))
	}
	// read, never written. A missing value is no value; a git that cannot run is an error.
	if rtn.GlobalName, err = gitConfigValue("--global", "user.name"); err != nil {
		return nil, err
	}
	if rtn.GlobalEmail, err = gitConfigValue("--global", "user.email"); err != nil {
		return nil, err
	}
	helpers, err := effectiveHelpers(false)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(helpers))
	for _, h := range helpers {
		names = append(names, helperName(h))
	}
	rtn.DefaultHelper = strings.Join(names, ", ")
	return rtn, nil
}

// Add checks the token with GitHub, then stores it and writes the account. Nothing is written for a refused token.
func Add(ctx context.Context, data wshrpc.CommandGitAccountAddData) (*wshrpc.GitAccountData, error) {
	token, err := cleanToken(data.Token)
	if err != nil {
		return nil, err
	}
	if err := checkLogin(data.Login); err != nil {
		return nil, err
	}
	user, err := checkToken(ctx, data.Login, token)
	if err != nil {
		return nil, err
	}
	a := account{Login: user.Login, Name: firstNonEmpty(data.Name, user.Name, user.Login), Email: firstNonEmpty(data.Email, user.Email), Roots: []string{}}
	if err := checkLine("the name", a.Name); err != nil {
		return nil, err
	}
	if err := checkEmail(a.Email); err != nil {
		return nil, err
	}
	if data.DefaultLogin != "" {
		if err := checkLogin(data.DefaultLogin); err != nil {
			return nil, err
		}
	}
	root := ""
	if data.Root != "" {
		if root, err = normalizeRoot(data.Root); err != nil {
			return nil, err
		}
	}

	mu.Lock()
	defer mu.Unlock()
	old, err := load()
	if err != nil {
		return nil, err
	}
	if old.find(a.Login) >= 0 {
		return nil, fmt.Errorf("%s is already added", a.Login)
	}
	cfg := old.clone()
	if data.DefaultLogin != "" {
		cfg.DefaultLogin = data.DefaultLogin
	}
	if cfg.DefaultLogin == "" {
		return nil, errors.New("the first account needs the default login: the account git uses outside every folder")
	}
	if root != "" {
		if err := checkOverlap(cfg, "", root); err != nil {
			return nil, err
		}
		a.Roots = append(a.Roots, root)
	}
	cfg.Accounts = append(cfg.Accounts, a)
	if err := storeToken(ctx, a.Login, token); err != nil {
		return nil, err
	}
	if err := apply(old, cfg, nil); err != nil {
		if rerr := rejectToken(ctx, a.Login); rerr != nil {
			log.Printf("[gitaccount] the token of %s stays in the credential store after a failed add: %v", a.Login, rerr)
		}
		return nil, err
	}
	d := toData(a)
	return &d, nil
}

// Update changes what commits carry: the name and the email ("" keeps a field). The login cannot change.
func Update(data wshrpc.CommandGitAccountUpdateData) error {
	if err := checkLine("the name", data.Name); err != nil {
		return err
	}
	if data.Email != "" {
		if err := checkEmail(data.Email); err != nil {
			return err
		}
	}
	mu.Lock()
	defer mu.Unlock()
	old, err := load()
	if err != nil {
		return err
	}
	i := old.find(data.Login)
	if i < 0 {
		return fmt.Errorf("no account %s", data.Login)
	}
	cfg := old.clone()
	if data.Name != "" {
		cfg.Accounts[i].Name = data.Name
	}
	if data.Email != "" {
		cfg.Accounts[i].Email = data.Email
	}
	return apply(old, cfg, nil)
}

// Remove drops the account, its file and its token. It is refused for the default login: the block's username line
// would name a login whose token was just rejected, and every push outside the roots would fail.
func Remove(ctx context.Context, login string) error {
	mu.Lock()
	defer mu.Unlock()
	old, err := load()
	if err != nil {
		return err
	}
	i := old.find(login)
	if i < 0 {
		return fmt.Errorf("no account %s", login)
	}
	if strings.EqualFold(old.Accounts[i].Login, old.DefaultLogin) {
		return errors.New("Change the default login first")
	}
	cfg := old.clone()
	cfg.Accounts = append(cfg.Accounts[:i], cfg.Accounts[i+1:]...)
	if len(cfg.Accounts) == 0 {
		// git goes back to what it did before arcterm, helper reset included
		cfg.GithubHelpers = nil
	}
	if err := apply(old, cfg, nil); err != nil {
		return err
	}
	if err := rejectToken(ctx, old.Accounts[i].Login); err != nil {
		return fmt.Errorf("%s is removed, but its token stays in the credential store: %w", login, err)
	}
	return nil
}

// SetDefault names the account git uses outside every root. It need not be one of the accounts.
func SetDefault(login string) error {
	if err := checkLogin(login); err != nil {
		return err
	}
	mu.Lock()
	defer mu.Unlock()
	old, err := load()
	if err != nil {
		return err
	}
	cfg := old.clone()
	cfg.DefaultLogin = login
	return apply(old, cfg, nil)
}

func AddRoot(login, root string) error {
	root, err := normalizeRoot(root)
	if err != nil {
		return err
	}
	mu.Lock()
	defer mu.Unlock()
	old, err := load()
	if err != nil {
		return err
	}
	i := old.find(login)
	if i < 0 {
		return fmt.Errorf("no account %s", login)
	}
	cfg := old.clone()
	if err := checkOverlap(cfg, cfg.Accounts[i].Login, root); err != nil {
		return err
	}
	for _, r := range cfg.Accounts[i].Roots {
		if sameRoot(r, root) {
			return fmt.Errorf("%s already has the folder %s", cfg.Accounts[i].Login, root)
		}
	}
	cfg.Accounts[i].Roots = append(cfg.Accounts[i].Roots, root)
	return apply(old, cfg, nil)
}

// RemoveRoot keeps the account, its token and its file: its row reads "No folder" and no include points at it.
func RemoveRoot(login, root string) error {
	root = rootKey(root)
	mu.Lock()
	defer mu.Unlock()
	old, err := load()
	if err != nil {
		return err
	}
	i := old.find(login)
	if i < 0 {
		return fmt.Errorf("no account %s", login)
	}
	cfg := old.clone()
	kept := cfg.Accounts[i].Roots[:0]
	found := false
	for _, r := range cfg.Accounts[i].Roots {
		if sameRoot(r, root) {
			found = true
			continue
		}
		kept = append(kept, r)
	}
	if !found {
		return fmt.Errorf("%s has no folder %s", cfg.Accounts[i].Login, root)
	}
	cfg.Accounts[i].Roots = kept
	return apply(old, cfg, nil)
}

// normalizeRoot returns the absolute, existing directory with symlinks resolved: git matches the resolved .git path
// (macOS temp dirs and /tmp are symlinks).
func normalizeRoot(root string) (string, error) {
	root = strings.TrimSpace(root)
	if !filepath.IsAbs(root) {
		return "", fmt.Errorf("%q is not an absolute folder path", root)
	}
	if err := checkLine("the folder", root); err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("folder %s: %w", root, err)
	}
	st, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("folder %s: %w", root, err)
	}
	if !st.IsDir() {
		return "", fmt.Errorf("%s is not a folder", root)
	}
	return filepath.Clean(resolved), nil
}

// rootKey is the form roots are compared in: a stored root, or one that no longer exists, resolves as far as it can.
func rootKey(root string) string {
	root = strings.TrimSpace(root)
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}
	return filepath.Clean(root)
}

func slashLower(p string) string { return strings.ToLower(filepath.ToSlash(filepath.Clean(p))) }

func sameRoot(a, b string) bool { return slashLower(rootKey(a)) == slashLower(rootKey(b)) }

func within(path, root string) bool {
	p, r := slashLower(path), slashLower(root)
	return p == r || strings.HasPrefix(p, strings.TrimSuffix(r, "/")+"/")
}

// checkOverlap refuses a root inside, or containing, another account's root: git's last matching include would decide
// silently which account wins.
func checkOverlap(cfg config, self, root string) error {
	for _, a := range cfg.Accounts {
		if strings.EqualFold(a.Login, self) {
			continue
		}
		for _, r := range a.Roots {
			if within(root, r) || within(r, root) {
				return fmt.Errorf("%s overlaps %s, a folder of %s", root, r, a.Login)
			}
		}
	}
	return nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
