// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavevault

import (
	"encoding/json"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// CouncilRolesSyncPath is the vault's councilroles.json, merged by role and group id.
const CouncilRolesSyncPath = wconfig.VaultConfigDir + "/" + wconfig.CouncilRolesFile

// councilRolesIdLists are the top-level keys of councilroles.json holding lists of objects keyed by "id".
var councilRolesIdLists = map[string]bool{"roles": true, "groups": true}

// MergeCouncilRoles three-way merges two versions of the vault's councilroles.json against their common ancestor
// (base, nil when there is none). The roles and groups lists merge by id, each entry one value under MergeSettings'
// rule: a role edited on one machine and another role edited on the other keep both edits, and the same role edited
// on both keeps ours. Ours's entries keep their order, and an entry only theirs has comes after them. Any other
// top-level key merges as a settings key does. An entry with no id, or a list that is not one, is an error.
func MergeCouncilRoles(base, ours, theirs []byte) ([]byte, error) {
	baseM := map[string]any{}
	if len(base) > 0 {
		var err error
		if baseM, err = parseSettingsObject("base", base); err != nil {
			return nil, err
		}
	}
	oursM, err := parseSettingsObject("ours", ours)
	if err != nil {
		return nil, err
	}
	theirsM, err := parseSettingsObject("theirs", theirs)
	if err != nil {
		return nil, err
	}

	merged := make(map[string]any)
	for _, m := range []map[string]any{baseM, oursM, theirsM} {
		for k := range m {
			if _, done := merged[k]; done {
				continue
			}
			if !councilRolesIdLists[k] {
				if v, keep := mergeSettingKey(baseM, oursM, theirsM, k); keep {
					merged[k] = v
				}
				continue
			}
			list, keep, err := mergeIdList(k, baseM[k], oursM[k], theirsM[k], hasKey(oursM, k) || hasKey(theirsM, k))
			if err != nil {
				return nil, err
			}
			if keep {
				merged[k] = list
			}
		}
	}
	out, err := json.MarshalIndent(merged, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("merge %s: %w", wconfig.CouncilRolesFile, err)
	}
	return append(out, '\n'), nil
}

func hasKey(m map[string]any, k string) bool {
	_, ok := m[k]
	return ok
}

// mergeIdList merges one id-keyed list; keep is false when neither side has the key any more.
func mergeIdList(key string, base, ours, theirs any, present bool) ([]any, bool, error) {
	baseIds, baseById, err := indexById(key, base)
	if err != nil {
		return nil, false, fmt.Errorf("base: %w", err)
	}
	oursIds, oursById, err := indexById(key, ours)
	if err != nil {
		return nil, false, fmt.Errorf("ours: %w", err)
	}
	theirsIds, theirsById, err := indexById(key, theirs)
	if err != nil {
		return nil, false, fmt.Errorf("theirs: %w", err)
	}
	out := []any{}
	seen := make(map[string]bool)
	for _, ids := range [][]string{oursIds, theirsIds, baseIds} {
		for _, id := range ids {
			if seen[id] {
				continue
			}
			seen[id] = true
			if v, keep := mergeSettingKey(baseById, oursById, theirsById, id); keep {
				out = append(out, v)
			}
		}
	}
	return out, present, nil
}

// indexById returns a list's ids in order and its entries by id. A missing list is empty.
func indexById(key string, v any) ([]string, map[string]any, error) {
	byId := map[string]any{}
	if v == nil {
		return nil, byId, nil
	}
	list, ok := v.([]any)
	if !ok {
		return nil, nil, fmt.Errorf("%s is not a list", key)
	}
	ids := make([]string, 0, len(list))
	for i, e := range list {
		obj, ok := e.(map[string]any)
		if !ok {
			return nil, nil, fmt.Errorf("%s[%d] is not an object", key, i)
		}
		id, _ := obj["id"].(string)
		if id == "" {
			return nil, nil, fmt.Errorf("%s[%d] has no id", key, i)
		}
		if _, dup := byId[id]; dup {
			return nil, nil, fmt.Errorf("%s has id %q twice", key, id)
		}
		ids = append(ids, id)
		byId[id] = e
	}
	return ids, byId, nil
}
