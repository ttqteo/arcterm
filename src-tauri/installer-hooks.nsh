; NSIS hooks for Tauri's installer template (tauri.conf.json bundle > windows > nsis > installerHooks).

; Installing over, or uninstalling, a running arcterm: the template's Restart Manager check, which runs right after
; these hooks, closes only wave-tauri.exe, and the wavesrv it leaves running holds bin\wavesrv.x64.exe open, so the
; copy (or the delete) fails halfway and leaves a broken install. Stop both of this install's own processes first,
; chosen by path: the dev app shares their image names, and stopping by name would take it (and its agents) down too.
; Interactive, it asks first, as the template would have; passive (/P, `task install`) and silent installs just close.

; powershell's exit code is how many of this install's processes are running
!define ARC_COUNT_RUNNING `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d = '$INSTDIR' + '\'; exit @(Get-Process wave-tauri,wavesrv.x64 -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$d, [StringComparison]::OrdinalIgnoreCase) }).Count"`
!define ARC_STOP_RUNNING `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d = '$INSTDIR' + '\'; Get-Process wave-tauri,wavesrv.x64 -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$d, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.Id -Force -ErrorAction SilentlyContinue; Wait-Process -Id $$_.Id -Timeout 10 -ErrorAction SilentlyContinue }"`

!macro ARC_STOP_INSTALLED
  ; one label per insertion, as the template's CheckIfAppIsRunning does
  !define ArcStopID ${__LINE__}
  nsExec::Exec `${ARC_COUNT_RUNNING}`
  Pop $0
  ${If} $0 > 0
    IfSilent arc_stop_${ArcStopID}
    ${If} $PassiveMode <> 1
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "arcterm is running. Close it, and every agent running in it, to continue?" IDOK arc_stop_${ArcStopID}
      Abort
    ${EndIf}
    arc_stop_${ArcStopID}:
    nsExec::Exec `${ARC_STOP_RUNNING}`
    Pop $0
  ${EndIf}
  !undef ArcStopID
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro ARC_STOP_INSTALLED
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro ARC_STOP_INSTALLED
!macroend
