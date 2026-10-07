; NSIS hooks for Tauri's installer template (tauri.conf.json bundle > windows > nsis > installerHooks).

; An install over a running arcterm (`task install`, which passes /P /UPDATE /R): the template's Restart Manager check,
; which runs right after this hook, closes only wave-tauri.exe, and the wavesrv it leaves running holds
; bin\wavesrv.x64.exe open, so the overwrite fails. Stop both of this install's own processes first, chosen by path:
; the dev app shares their image names, and stopping by name would take it (and its agents) down too. A plain
; double-click install is left to the template, which asks before it closes the app.
!macro NSIS_HOOK_PREINSTALL
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    nsExec::ExecToLog `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d = '$INSTDIR' + '\'; Get-Process wave-tauri,wavesrv.x64 -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$d, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.Id -Force -ErrorAction SilentlyContinue; Wait-Process -Id $$_.Id -Timeout 10 -ErrorAction SilentlyContinue }"`
    Pop $0
  ${EndIf}
!macroend
