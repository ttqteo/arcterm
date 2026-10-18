// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// PackageCache is one cache a package manager or toolchain keeps for every project on the machine: what it
// downloaded or built once, which the next install or build fetches or makes again.
type PackageCache struct {
	ID     string // what a clean names it by: "npm", "go-build"
	Label  string
	Path   string
	Detail string // Path as its row shows it, ~ for the home dir
}

// PackageCacheDirs is where the package managers keep their caches on goos, read from their own variables first
// (GOCACHE, CARGO_HOME…) and else their defaults. A path that is relative, or that is home or holds it, is left out:
// a variable set wrong never points a clean at the home dir. Playwright's browsers and rustup's toolchains are not
// caches: nothing downloads them again on its own.
func PackageCacheDirs(goos, home string, getenv func(string) string) []PackageCache {
	env := func(key, fallback string) string {
		if v := getenv(key); v != "" {
			return v
		}
		return fallback
	}
	local := getenv("LOCALAPPDATA")
	if local == "" {
		local = filepath.Join(home, "AppData", "Local")
	}
	// the per-user cache dir Go uses for its build cache, and XDG tools on Linux
	xdgCache := env("XDG_CACHE_HOME", filepath.Join(home, ".cache"))
	userCache := xdgCache
	switch goos {
	case "darwin":
		userCache = filepath.Join(home, "Library", "Caches")
	case "windows":
		userCache = local
	}
	gopath := filepath.Join(home, "go")
	if list := filepath.SplitList(getenv("GOPATH")); len(list) > 0 && list[0] != "" {
		gopath = list[0]
	}
	cargo := env("CARGO_HOME", filepath.Join(home, ".cargo"))

	goCache := env("GOCACHE", filepath.Join(userCache, "go-build"))
	if goCache == "off" {
		goCache = ""
	}
	npm := filepath.Join(home, ".npm", "_cacache")
	pnpm := filepath.Join(env("XDG_DATA_HOME", filepath.Join(home, ".local", "share")), "pnpm", "store")
	yarn := filepath.Join(xdgCache, "yarn")
	pip := filepath.Join(xdgCache, "pip")
	uv := filepath.Join(xdgCache, "uv")
	switch goos {
	case "darwin":
		pnpm = filepath.Join(home, "Library", "pnpm", "store")
		yarn = filepath.Join(userCache, "Yarn")
		pip = filepath.Join(userCache, "pip")
	case "windows":
		npm = filepath.Join(local, "npm-cache", "_cacache")
		pnpm = filepath.Join(local, "pnpm", "store")
		yarn = filepath.Join(local, "Yarn", "Cache")
		pip = filepath.Join(local, "pip", "Cache")
		uv = filepath.Join(local, "uv", "cache")
	}

	all := []PackageCache{
		{ID: "go-build", Label: "Go build cache", Path: goCache},
		{ID: "go-mod", Label: "Go modules", Path: env("GOMODCACHE", filepath.Join(gopath, "pkg", "mod"))},
		{ID: "npm", Label: "npm cache", Path: npm},
		{ID: "pnpm", Label: "pnpm store", Path: pnpm},
		{ID: "yarn", Label: "Yarn cache", Path: yarn},
		{ID: "yarn-berry", Label: "Yarn Berry cache", Path: filepath.Join(home, ".yarn", "berry", "cache")},
		{ID: "bun", Label: "Bun cache", Path: env("BUN_INSTALL_CACHE_DIR", filepath.Join(home, ".bun", "install", "cache"))},
		{ID: "cargo-registry", Label: "Cargo registry", Path: filepath.Join(cargo, "registry")},
		{ID: "cargo-git", Label: "Cargo git checkouts", Path: filepath.Join(cargo, "git")},
		{ID: "pip", Label: "pip cache", Path: pip},
		{ID: "uv", Label: "uv cache", Path: env("UV_CACHE_DIR", uv)},
	}
	if goos == "darwin" {
		all = append(all, PackageCache{ID: "homebrew", Label: "Homebrew downloads",
			Path: env("HOMEBREW_CACHE", filepath.Join(userCache, "Homebrew"))})
	}
	var out []PackageCache
	for _, c := range all {
		if c.Path == "" || !filepath.IsAbs(c.Path) || isInside(home, c.Path) {
			continue
		}
		c.Path = filepath.Clean(c.Path)
		c.Detail = c.Path
		if rel, err := filepath.Rel(home, c.Path); err == nil && isInside(c.Path, home) {
			c.Detail = filepath.Join("~", rel)
		}
		out = append(out, c)
	}
	return out
}

// isInside is whether p is dir or lies under it.
func isInside(p, dir string) bool {
	rel, err := filepath.Rel(dir, p)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// packageCaches lists the caches that exist and removes the one a row asks for: never automatically, and never
// while a build or an install runs, which may be reading the cache that moment.
type packageCaches struct{}

func (packageCaches) category() StorageCategory { return CategoryPackageCaches }

func (packageCaches) measure(ctx context.Context, env *Env) StorageCategoryReport {
	why := busyCachesReason(env)
	var items []StorageItem
	for _, c := range env.PackageCaches {
		if !isPlainDir(c.Path) {
			continue
		}
		items = append(items, StorageItem{ID: c.ID, Kind: KindCache, Label: c.Label, Detail: c.Detail, Path: c.Path,
			Bytes: dirSize(c.Path), Cleanable: why == "", Reason: why})
	}
	return report(CategoryPackageCaches, items, nil)
}

func busyCachesReason(env *Env) string {
	if env.BusyCaches == nil {
		return ""
	}
	return env.BusyCaches()
}

func (packageCaches) clean(ctx context.Context, env *Env, ids []string, opts CleanOpts) StorageCleanResult {
	var res StorageCleanResult
	for _, id := range ids {
		if opts.Auto {
			skip(&res, id, "package caches are cleaned only when you ask")
			continue
		}
		if why := busyCachesReason(env); why != "" {
			skip(&res, id, why)
			continue
		}
		// an id names a cache arcterm knows, never a path: a clean cannot be pointed anywhere else
		var cache *PackageCache
		for i := range env.PackageCaches {
			if env.PackageCaches[i].ID == id {
				cache = &env.PackageCaches[i]
			}
		}
		switch {
		case cache == nil:
			skip(&res, id, "not a package cache")
			continue
		case !isPlainDir(cache.Path):
			skip(&res, id, "not a directory (a link is never removed)")
			continue
		}
		size := dirSize(cache.Path)
		if err := removeTree(cache.Path); err != nil {
			skip(&res, id, "couldn't remove: "+err.Error())
			res.Reclaimed += size - dirSize(cache.Path)
			continue
		}
		res.Reclaimed += size
		res.Cleaned = append(res.Cleaned, id)
	}
	return res
}

// removeTree removes root and everything under it. Go's module cache makes its directories read-only, which stops a
// removal on Unix, so when the first try fails each directory is made writable and it tries again. Links are removed,
// never followed.
func removeTree(root string) error {
	if err := os.RemoveAll(root); err == nil {
		return nil
	}
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err == nil && d.IsDir() {
			_ = os.Chmod(p, 0o755)
		}
		return nil
	})
	return os.RemoveAll(root)
}
