// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig/defaultconfig"
)

const SettingsFile = "settings.json"
const ConnectionsFile = "connections.json"
const ProfilesFile = "profiles.json"
const ProjectsFile = "projects.json"

var configWriteLock sync.Mutex

const AnySchema = `
{
  "type": "object",
  "additionalProperties": true
}
`

type SettingsType struct {
	AppClear                   bool  `json:"app:*,omitempty"`
	AppCtrlVPaste              *bool `json:"app:ctrlvpaste,omitempty"`
	AppDisableCtrlShiftDisplay bool  `json:"app:disablectrlshiftdisplay,omitempty"`

	NotifyClear bool  `json:"notify:*,omitempty"`
	NotifyOs    *bool `json:"notify:os,omitempty"`
	NotifyToast *bool `json:"notify:toast,omitempty"`
	NotifyReply *bool `json:"notify:reply,omitempty"`

	TermClear                  bool     `json:"term:*,omitempty"`
	TermFontSize               float64  `json:"term:fontsize,omitempty"`
	TermFontFamily             string   `json:"term:fontfamily,omitempty"`
	TermDisableWebGl           bool     `json:"term:disablewebgl,omitempty"`
	TermLocalShellPath         string   `json:"term:localshellpath,omitempty"`
	TermLocalShellOpts         []string `json:"term:localshellopts,omitempty"`
	TermGitBashPath            string   `json:"term:gitbashpath,omitempty"`
	TermScrollback             *int64   `json:"term:scrollback,omitempty"`
	TermCopyOnSelect           *bool    `json:"term:copyonselect,omitempty"`
	TermAllowBracketedPaste    *bool    `json:"term:allowbracketedpaste,omitempty"`
	TermShiftEnterNewline      *bool    `json:"term:shiftenternewline,omitempty"`
	TermMacOptionIsMeta        *bool    `json:"term:macoptionismeta,omitempty"`
	TermCursor                 string   `json:"term:cursor,omitempty"`
	TermCursorBlink            *bool    `json:"term:cursorblink,omitempty"`
	TermBellIndicator          *bool    `json:"term:bellindicator,omitempty"`
	TermOsc52                  string   `json:"term:osc52,omitempty" jsonschema:"enum=focus,enum=always"`
	TermTrimTrailingWhitespace *bool    `json:"term:trimtrailingwhitespace,omitempty"`

	MemoryVaultPath              string `json:"memory:vaultpath,omitempty"`
	HeadlessRuntime              string `json:"headless:runtime,omitempty"`
	HeadlessOpenRouterCheapModel string `json:"headless:openroutercheapmodel,omitempty"`
	JarvisVaultPath              string `json:"jarvis:vaultpath,omitempty"`

	EditorMinimapEnabled      bool    `json:"editor:minimapenabled,omitempty"`
	EditorStickyScrollEnabled bool    `json:"editor:stickyscrollenabled,omitempty"`
	EditorWordWrap            bool    `json:"editor:wordwrap,omitempty"`
	EditorFontSize            float64 `json:"editor:fontsize,omitempty"`
	EditorInlineDiff          bool    `json:"editor:inlinediff,omitempty"`

	WindowClear                         bool     `json:"window:*,omitempty"`
	WindowReducedMotion                 bool     `json:"window:reducedmotion,omitempty"`
	WindowMagnifiedBlockOpacity         *float64 `json:"window:magnifiedblockopacity,omitempty"`
	WindowMagnifiedBlockSize            *float64 `json:"window:magnifiedblocksize,omitempty"`
	WindowMagnifiedBlockBlurSecondaryPx *int64   `json:"window:magnifiedblockblursecondarypx,omitempty"`

	ConnClear                bool    `json:"conn:*,omitempty"`
	ConnLocalHostnameDisplay *string `json:"conn:localhostdisplayname,omitempty"`

	DebugClear               bool `json:"debug:*,omitempty"`
	DebugPprofPort           *int `json:"debug:pprofport,omitempty"`
	DebugPprofMemProfileRate *int `json:"debug:pprofmemprofilerate,omitempty"`
	DebugWebGlStatus         bool `json:"debug:webglstatus,omitempty"`

	HarnessPreferredRuntime string `json:"harness:preferredruntime,omitempty"`
	HarnessPreferredModel   string `json:"harness:preferredmodel,omitempty"`
	HarnessUpdateCheck      *bool  `json:"harness:updatecheck,omitempty"`

	ClaudeClear         bool   `json:"claude:*,omitempty"`
	ClaudeActiveAccount string `json:"claude:activeaccount,omitempty"`

	RadarAuditRuntime string `json:"radar:auditruntime,omitempty"`
	RadarAuditModel   string `json:"radar:auditmodel,omitempty"`

	UsageInsightsLang string `json:"usage:insightslang,omitempty"` // language the usage analysis answers in; empty is English

	JobsSlots *int   `json:"jobs:slots,omitempty"` // heavy jobs run at once (pkg/jobqueue), 1–4; unset is 1
	JobsMode  string `json:"jobs:mode,omitempty"`  // how the queue starts them: "auto" (unset; as RAM allows), "slots" (jobs:slots at once), "off" (at once)
	// JobsPauseUntil turns the queue off until then (Unix ms): the Jobs popover's Pause 1h / 4h; 0 or past is no pause
	JobsPauseUntil *int64 `json:"jobs:pauseuntil,omitempty"`
}

type ConfigError struct {
	File string `json:"file"`
	Err  string `json:"err"`
}

type FullConfigType struct {
	Settings SettingsType `json:"settings" merge:"meta"`
	// Settings as they ship, with no home-directory overrides applied. Settings is the merge of this and
	// the user's settings.json, so on its own it cannot say which keys the user actually changed — the
	// Settings surface diffs the two to mark changed rows and to know what value Revert writes back.
	DefaultSettings SettingsType               `json:"defaultsettings" configfile:"-"`
	Connections     map[string]ConnKeywords    `json:"connections"`
	Projects        map[string]ProjectKeywords `json:"projects"`
	ConfigErrors    []ConfigError              `json:"configerrors" configfile:"-"`
	Version         string                     `json:"version" configfile:"-"`
	BuildTime       string                     `json:"buildtime" configfile:"-"`
}

type ProjectKeywords struct {
	Path string `json:"path,omitempty"`
}

type ConnKeywords struct {
	DisplayOrder float32 `json:"display:order,omitempty"`

	TermClear      bool    `json:"term:*,omitempty"`
	TermFontSize   float64 `json:"term:fontsize,omitempty"`
	TermFontFamily string  `json:"term:fontfamily,omitempty"`

	CmdEnv            map[string]string `json:"cmd:env,omitempty"`
	CmdInitScript     string            `json:"cmd:initscript,omitempty"`
	CmdInitScriptSh   string            `json:"cmd:initscript.sh,omitempty"`
	CmdInitScriptBash string            `json:"cmd:initscript.bash,omitempty"`
	CmdInitScriptZsh  string            `json:"cmd:initscript.zsh,omitempty"`
	CmdInitScriptPwsh string            `json:"cmd:initscript.pwsh,omitempty"`
	CmdInitScriptFish string            `json:"cmd:initscript.fish,omitempty"`
}

func goBackWS(barr []byte, offset int) int {
	if offset >= len(barr) {
		offset = offset - 1
	}
	for i := offset - 1; i >= 0; i-- {
		if barr[i] == ' ' || barr[i] == '\t' || barr[i] == '\n' || barr[i] == '\r' {
			continue
		}
		return i
	}
	return 0
}

func isTrailingCommaError(barr []byte, offset int) bool {
	if offset >= len(barr) {
		offset = offset - 1
	}
	offset = goBackWS(barr, offset)
	if barr[offset] == '}' {
		offset = goBackWS(barr, offset)
		if barr[offset] == ',' {
			return true
		}
	}
	return false
}

func resolveEnvReplacements(m waveobj.MetaMapType) {
	if m == nil {
		return
	}

	for key, value := range m {
		switch v := value.(type) {
		case string:
			if resolved, ok := resolveEnvValue(v); ok {
				m[key] = resolved
			}
		case map[string]interface{}:
			resolveEnvReplacements(waveobj.MetaMapType(v))
		case []interface{}:
			resolveEnvArray(v)
		}
	}
}

func resolveEnvArray(arr []interface{}) {
	for i, value := range arr {
		switch v := value.(type) {
		case string:
			if resolved, ok := resolveEnvValue(v); ok {
				arr[i] = resolved
			}
		case map[string]interface{}:
			resolveEnvReplacements(waveobj.MetaMapType(v))
		case []interface{}:
			resolveEnvArray(v)
		}
	}
}

func resolveEnvValue(value string) (string, bool) {
	if !strings.HasPrefix(value, "$ENV:") {
		return "", false
	}

	envSpec := value[5:] // Remove "$ENV:" prefix
	parts := strings.SplitN(envSpec, ":", 2)
	envVar := parts[0]
	var fallback string
	if len(parts) > 1 {
		fallback = parts[1]
	}

	// Get the environment variable value
	if envValue, exists := os.LookupEnv(envVar); exists {
		return envValue, true
	}

	// Return fallback if provided, otherwise return empty string
	if fallback != "" {
		return fallback, true
	}
	return "", true
}

func readConfigHelper(fileName string, barr []byte, readErr error) (waveobj.MetaMapType, []ConfigError) {
	rtn, cerrs := parseConfigHelper(fileName, barr, readErr)
	if rtn != nil {
		resolveEnvReplacements(rtn)
	}
	return rtn, cerrs
}

func parseConfigHelper(fileName string, barr []byte, readErr error) (waveobj.MetaMapType, []ConfigError) {
	var cerrs []ConfigError
	if readErr != nil && !os.IsNotExist(readErr) {
		cerrs = append(cerrs, ConfigError{File: fileName, Err: readErr.Error()})
	}
	if len(barr) == 0 {
		return nil, cerrs
	}
	var rtn waveobj.MetaMapType
	err := json.Unmarshal(barr, &rtn)
	if err != nil {
		if syntaxErr, ok := err.(*json.SyntaxError); ok {
			offset := syntaxErr.Offset
			if offset > 0 {
				offset = offset - 1
			}
			lineNum, colNum := utilfn.GetLineColFromOffset(barr, int(offset))
			isTrailingComma := isTrailingCommaError(barr, int(offset))
			if isTrailingComma {
				err = fmt.Errorf("json syntax error at line %d, col %d: probably an extra trailing comma: %v", lineNum, colNum, syntaxErr)
			} else {
				err = fmt.Errorf("json syntax error at line %d, col %d: %v", lineNum, colNum, syntaxErr)
			}
		}
		cerrs = append(cerrs, ConfigError{File: fileName, Err: err.Error()})
	}
	return rtn, cerrs
}

func readConfigFileFS(fsys fs.FS, logPrefix string, fileName string) (waveobj.MetaMapType, []ConfigError) {
	barr, readErr := fs.ReadFile(fsys, fileName)
	if readErr != nil {
		// If we get an error, we may be using the wrong path separator for the given FS interface. Try switching the separator.
		barr, readErr = fs.ReadFile(fsys, filepath.ToSlash(fileName))
	}
	return readConfigHelper(logPrefix+fileName, barr, readErr)
}

func ReadWaveHomeConfigFile(fileName string) (waveobj.MetaMapType, []ConfigError) {
	configDirAbsPath := wavebase.GetWaveConfigDir()
	configDirFsys := os.DirFS(configDirAbsPath)
	return readConfigFileFS(configDirFsys, "", fileName)
}

func WriteWaveHomeConfigFile(fileName string, m waveobj.MetaMapType) error {
	configWriteLock.Lock()
	defer configWriteLock.Unlock()
	return writeWaveHomeConfigFileLocked(fileName, m)
}

// writeWaveHomeConfigFileLocked assumes configWriteLock is held. The Set/Delete functions hold the
// lock across their whole read-modify-write so two concurrent updates of different keys can't
// interleave reads and silently drop the first write.
func writeWaveHomeConfigFileLocked(fileName string, m waveobj.MetaMapType) error {
	configDirAbsPath := wavebase.GetWaveConfigDir()
	fullFileName := filepath.Join(configDirAbsPath, fileName)
	barr, err := jsonMarshalConfigInOrder(m)
	if err != nil {
		return err
	}
	return fileutil.AtomicWriteFile(fullFileName, barr, 0644)
}

// simple merge that overwrites
func mergeMetaMapSimple(m waveobj.MetaMapType, toMerge waveobj.MetaMapType) waveobj.MetaMapType {
	if m == nil {
		return toMerge
	}
	if toMerge == nil {
		return m
	}
	for k, v := range toMerge {
		if v == nil {
			delete(m, k)
			continue
		}
		m[k] = v
	}
	if len(m) == 0 {
		return nil
	}
	return m
}

func mergeMetaMap(m waveobj.MetaMapType, toMerge waveobj.MetaMapType, simpleMerge bool) waveobj.MetaMapType {
	if simpleMerge {
		return mergeMetaMapSimple(m, toMerge)
	} else {
		return waveobj.MergeMeta(m, toMerge, true)
	}
}

func selectDirEntsBySuffix(dirEnts []fs.DirEntry, fileNameSuffix string) []fs.DirEntry {
	var rtn []fs.DirEntry
	for _, ent := range dirEnts {
		if ent.IsDir() {
			continue
		}
		if !strings.HasSuffix(ent.Name(), fileNameSuffix) {
			continue
		}
		rtn = append(rtn, ent)
	}
	return rtn
}

func SortFileNameDescend(files []fs.DirEntry) {
	sort.Slice(files, func(i, j int) bool {
		return files[i].Name() > files[j].Name()
	})
}

// Read and merge all files in the specified directory matching the supplied suffix
func readConfigFilesForDir(fsys fs.FS, logPrefix string, dirName string, fileName string, simpleMerge bool) (waveobj.MetaMapType, []ConfigError) {
	dirEnts, _ := fs.ReadDir(fsys, dirName)
	suffixEnts := selectDirEntsBySuffix(dirEnts, fileName+".json")
	SortFileNameDescend(suffixEnts)
	var rtn waveobj.MetaMapType
	var errs []ConfigError
	for _, ent := range suffixEnts {
		fileVal, cerrs := readConfigFileFS(fsys, logPrefix, filepath.Join(dirName, ent.Name()))
		rtn = mergeMetaMap(rtn, fileVal, simpleMerge)
		errs = append(errs, cerrs...)
	}
	return rtn, errs
}

// Read and merge all files in the specified config filesystem matching the patterns `<partName>.json` and `<partName>/*.json`
func readConfigPartForFS(fsys fs.FS, logPrefix string, partName string, simpleMerge bool) (waveobj.MetaMapType, []ConfigError) {
	config, errs := readConfigFilesForDir(fsys, logPrefix, partName, "", simpleMerge)
	allErrs := errs
	rtn := config
	config, errs = readConfigFileFS(fsys, logPrefix, partName+".json")
	allErrs = append(allErrs, errs...)
	return mergeMetaMap(rtn, config, simpleMerge), allErrs
}

// Combine files from the defaults and home directory for the specified config part name
func readConfigPart(partName string, simpleMerge bool) (waveobj.MetaMapType, []ConfigError) {
	configDirAbsPath := wavebase.GetWaveConfigDir()
	configDirFsys := os.DirFS(configDirAbsPath)
	defaultConfigs, cerrs := readConfigPartForFS(defaultconfig.ConfigFS, "defaults:", partName, simpleMerge)
	homeConfigs, cerrs1 := readConfigPartForFS(configDirFsys, "", partName, simpleMerge)

	rtn := defaultConfigs
	allErrs := append(cerrs, cerrs1...)
	return mergeMetaMap(rtn, homeConfigs, simpleMerge), allErrs
}

// this function should only be called by the wconfig code.
// in golang code, the best way to get the current config is via the watcher -- wconfig.GetWatcher().GetFullConfig()
func ReadFullConfig() FullConfigType {
	var fullConfig FullConfigType
	configRType := reflect.TypeOf(fullConfig)
	configRVal := reflect.ValueOf(&fullConfig).Elem()
	for fieldIdx := 0; fieldIdx < configRType.NumField(); fieldIdx++ {
		field := configRType.Field(fieldIdx)
		if field.PkgPath != "" {
			continue
		}
		configFile := field.Tag.Get("configfile")
		if configFile == "-" {
			continue
		}
		jsonTag := utilfn.GetJsonTag(field)
		simpleMerge := field.Tag.Get("merge") == ""
		var configPart waveobj.MetaMapType
		var errs []ConfigError
		if jsonTag == "-" || jsonTag == "" {
			continue
		} else if jsonTag == settingsPart {
			configPart, errs = readSettingsPart()
		} else {
			configPart, errs = readConfigPart(jsonTag, simpleMerge)
		}
		fullConfig.ConfigErrors = append(fullConfig.ConfigErrors, errs...)
		if configPart != nil {
			fieldPtr := configRVal.Field(fieldIdx).Addr().Interface()
			utilfn.ReUnmarshal(fieldPtr, configPart)
		}
	}
	fullConfig.DefaultSettings = readDefaultSettings()
	fullConfig.Version = wavebase.WaveVersion
	fullConfig.BuildTime = wavebase.BuildTime
	return fullConfig
}

// The settings part read from the embedded defaults alone. readConfigPart always folds the home
// directory in on top, which is exactly what this must not do.
func readDefaultSettings() SettingsType {
	// simpleMerge=false matches the `merge:"meta"` tag on FullConfigType.Settings.
	configPart, _ := readConfigPartForFS(defaultconfig.ConfigFS, "defaults:", "settings", false)
	var rtn SettingsType
	if configPart != nil {
		utilfn.ReUnmarshal(&rtn, configPart)
	}
	return rtn
}

func GetConfigSubdirs() []string {
	var fullConfig FullConfigType
	configRType := reflect.TypeOf(fullConfig)
	var retVal []string
	configDirAbsPath := wavebase.GetWaveConfigDir()
	for fieldIdx := 0; fieldIdx < configRType.NumField(); fieldIdx++ {
		field := configRType.Field(fieldIdx)
		if field.PkgPath != "" {
			continue
		}
		configFile := field.Tag.Get("configfile")
		if configFile == "-" {
			continue
		}
		jsonTag := utilfn.GetJsonTag(field)
		if jsonTag != "-" && jsonTag != "" && jsonTag != "settings" {
			retVal = append(retVal, filepath.Join(configDirAbsPath, jsonTag))
		}
	}
	log.Printf("subdirs: %v\n", retVal)
	return retVal
}

func getConfigKeyType(configKey string) reflect.Type {
	ctype := reflect.TypeOf(SettingsType{})
	for i := 0; i < ctype.NumField(); i++ {
		field := ctype.Field(i)
		jsonTag := utilfn.GetJsonTag(field)
		if jsonTag == configKey {
			return field.Type
		}
	}
	return nil
}

func getConfigKeyNamespace(key string) string {
	colonIdx := strings.Index(key, ":")
	if colonIdx == -1 {
		return ""
	}
	return key[:colonIdx]
}

func orderConfigKeys(m waveobj.MetaMapType) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		k1 := keys[i]
		k2 := keys[j]
		k1ns := getConfigKeyNamespace(k1)
		k2ns := getConfigKeyNamespace(k2)
		if k1ns != k2ns {
			return k1ns < k2ns
		}
		return k1 < k2
	})
	return keys
}

func reindentJson(barr []byte, indentStr string) []byte {
	if len(barr) < 2 {
		return barr
	}
	if barr[0] != '{' && barr[0] != '[' {
		return barr
	}
	if !bytes.Contains(barr, []byte("\n")) {
		return barr
	}
	outputLines := bytes.Split(barr, []byte("\n"))
	for i, line := range outputLines {
		if i == 0 {
			continue
		}
		outputLines[i] = append([]byte(indentStr), line...)
	}
	return bytes.Join(outputLines, []byte("\n"))
}

func jsonMarshalConfigInOrder(m waveobj.MetaMapType) ([]byte, error) {
	if len(m) == 0 {
		return []byte("{}"), nil
	}
	var buf bytes.Buffer
	orderedKeys := orderConfigKeys(m)
	buf.WriteString("{\n")
	for idx, key := range orderedKeys {
		val := m[key]
		keyBarr, err := json.Marshal(key)
		if err != nil {
			return nil, err
		}
		valBarr, err := json.MarshalIndent(val, "", "  ")
		if err != nil {
			return nil, err
		}
		valBarr = reindentJson(valBarr, "  ")
		buf.WriteString("  ")
		buf.Write(keyBarr)
		buf.WriteString(": ")
		buf.Write(valBarr)
		if idx < len(orderedKeys)-1 {
			buf.WriteString(",")
		}
		buf.WriteString("\n")
	}
	buf.WriteString("}")
	return buf.Bytes(), nil
}

var dummyNumber json.Number

func convertJsonNumber(num json.Number, ctype reflect.Type) (interface{}, error) {
	// ctype might be int, int64, float64, string, *int, *int64, *float64, *string
	// switch on ctype first
	if ctype.Kind() == reflect.Pointer {
		ctype = ctype.Elem()
	}
	if reflect.Int == ctype.Kind() {
		if ival, err := num.Int64(); err == nil && int64(int(ival)) == ival {
			return int(ival), nil
		}
		return nil, fmt.Errorf("invalid number for int: %s", num)
	}
	if reflect.Int64 == ctype.Kind() {
		if ival, err := num.Int64(); err == nil {
			return ival, nil
		}
		return nil, fmt.Errorf("invalid number for int64: %s", num)
	}
	if reflect.Float64 == ctype.Kind() {
		if fval, err := num.Float64(); err == nil {
			return fval, nil
		}
		return nil, fmt.Errorf("invalid number for float64: %s", num)
	}
	if reflect.String == ctype.Kind() {
		return num.String(), nil
	}
	return nil, fmt.Errorf("cannot convert number to %s", ctype)
}

func convertConfigValue(configKey string, val any, ctype reflect.Type) (any, error) {
	rtype := reflect.TypeOf(val)
	if rtype == reflect.TypeOf(dummyNumber) {
		convertedVal, err := convertJsonNumber(val.(json.Number), ctype)
		if err != nil {
			return nil, fmt.Errorf("cannot convert %s: %v", configKey, err)
		}
		val = convertedVal
		rtype = reflect.TypeOf(val)
	}
	if rtype != ctype {
		if ctype == reflect.PointerTo(rtype) {
			return &val, nil
		}
		return nil, fmt.Errorf("invalid value type for %s: %T", configKey, val)
	}
	return val, nil
}

// SetBaseConfigValue writes each key to the settings layer that owns it: a machine-local key, or one the
// local file already defines (a per-machine override), goes to the local file; every other key goes to
// the vault layer, which syncs. A nil value deletes the key from whichever file holds it.
func SetBaseConfigValue(toMerge waveobj.MetaMapType) error {
	vaultWritten, err := setBaseConfigValueLocked(toMerge)
	if vaultWritten {
		notifyVaultLayerWrite()
	}
	return err
}

func setBaseConfigValueLocked(toMerge waveobj.MetaMapType) (bool, error) {
	configWriteLock.Lock()
	defer configWriteLock.Unlock()
	local, err := readSettingsFileRaw(localSettingsPath())
	if err != nil {
		return false, err
	}
	vaultPath := VaultSettingsPath()
	vault, err := readSettingsFileRaw(vaultPath)
	if err != nil {
		return false, err
	}
	var localDirty, vaultDirty bool
	for configKey, val := range toMerge {
		ctype := getConfigKeyType(configKey)
		if ctype == nil {
			return false, fmt.Errorf("invalid config key: %s", configKey)
		}
		if val == nil {
			if _, ok := local[configKey]; ok {
				delete(local, configKey)
				localDirty = true
			}
			if _, ok := vault[configKey]; ok {
				delete(vault, configKey)
				vaultDirty = true
			}
			continue
		}
		converted, err := convertConfigValue(configKey, val, ctype)
		if err != nil {
			return false, err
		}
		if _, definedLocally := local[configKey]; definedLocally || IsMachineLocalKey(configKey) {
			local[configKey] = converted
			localDirty = true
		} else {
			vault[configKey] = converted
			vaultDirty = true
		}
	}
	if vaultDirty {
		if err := writeVaultLayerLocked(vaultPath, vault); err != nil {
			return false, err
		}
	}
	if localDirty {
		if err := writeWaveHomeConfigFileLocked(SettingsFile, local); err != nil {
			return vaultDirty, err
		}
	}
	return vaultDirty, nil
}

// samePath compares two registered paths. A project stores its path verbatim and a caller passes whatever
// the user typed, so the same directory arrives with either slash direction and with or without a trailing
// one. Case is folded only on Windows: elsewhere two paths differing in case are two directories, and
// folding would reject a legitimate registration.
func samePath(a, b string) bool {
	norm := func(p string) string {
		return strings.TrimRight(strings.ReplaceAll(strings.TrimSpace(p), `\`, "/"), "/")
	}
	a, b = norm(a), norm(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// ProjectNameAtPath reports the project already registered at path, if any. Two projects at one path make
// the frontend's path->name resolution pick an arbitrary winner, so registration refuses the second rather
// than the resolver learning a tie-break for data that should not exist.
func ProjectNameAtPath(path string) (string, bool) {
	if strings.TrimSpace(path) == "" {
		return "", false
	}
	m, cerrs := ReadWaveHomeConfigFile(ProjectsFile)
	if len(cerrs) > 0 || m == nil {
		return "", false
	}
	for name := range m {
		proj := m.GetMap(name)
		if proj != nil && samePath(proj.GetString("path", ""), path) {
			return name, true
		}
	}
	return "", false
}

func SetProjectConfigValue(projName string, toMerge waveobj.MetaMapType) error {
	configWriteLock.Lock()
	defer configWriteLock.Unlock()
	m, cerrs := ReadWaveHomeConfigFile(ProjectsFile)
	if len(cerrs) > 0 {
		return fmt.Errorf("error reading config file: %v", cerrs[0])
	}
	if m == nil {
		m = make(waveobj.MetaMapType)
	}
	projData := m.GetMap(projName)
	if projData == nil {
		projData = make(waveobj.MetaMapType)
	}
	for configKey, val := range toMerge {
		projData[configKey] = val
	}
	m[projName] = projData
	return writeWaveHomeConfigFileLocked(ProjectsFile, m)
}

func DeleteProjectConfigValue(projName string) error {
	configWriteLock.Lock()
	defer configWriteLock.Unlock()
	m, cerrs := ReadWaveHomeConfigFile(ProjectsFile)
	if len(cerrs) > 0 {
		return fmt.Errorf("error reading config file: %v", cerrs[0])
	}
	if m == nil {
		return nil // nothing registered, deleting is a no-op
	}
	delete(m, projName)
	return writeWaveHomeConfigFileLocked(ProjectsFile, m)
}
