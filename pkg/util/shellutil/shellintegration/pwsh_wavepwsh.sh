# We source this file with -NoExit -File
$env:PATH = {{.WSHBINDIR_PWSH}} + "{{.PATHSEP}}" + $env:PATH

# Source dynamic script from wsh token
$waveterm_swaptoken_output = wsh token $env:WAVETERM_SWAPTOKEN pwsh 2>$null | Out-String
if ($waveterm_swaptoken_output -and $waveterm_swaptoken_output -ne "") {
    Invoke-Expression $waveterm_swaptoken_output
}
Remove-Variable -Name waveterm_swaptoken_output
Remove-Item Env:WAVETERM_SWAPTOKEN

# Load Wave completions
wsh completion powershell | Out-String | Invoke-Expression

# Report each command line as PSReadLine accepts it (OSC 16162 C), on Windows PowerShell 5.1 as well as 7: the
# cockpit names a plain terminal for what it last ran. The history handler sees the whole line before it runs; the
# handler already set (PSReadLine's sensitive-line filter by default) still decides whether it is saved.
# The host may load PSReadLine only once this script has run, so load it here.
if (-not (Get-Module PSReadLine)) {
    Import-Module PSReadLine -ErrorAction SilentlyContinue
}
if (-not ($env:TMUX -or $env:STY) -and (Get-Module PSReadLine)) {
    $Global:_waveterm_si_historyhandler = (Get-PSReadLineOption).AddToHistoryHandler
    Set-PSReadLineOption -AddToHistoryHandler {
        param([string]$line)
        try {
            $cmd64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($line))
            [Console]::Write([char]27 + ']16162;C;{"cmd64":"' + $cmd64 + '"}' + [char]7)
        } catch {}
        if ($Global:_waveterm_si_historyhandler) {
            return $Global:_waveterm_si_historyhandler.Invoke($line)
        }
        return $true
    }
}

# Mark each prompt (OSC 16162 A), on 5.1 as well as 7: the cockpit shows a terminal as running from the command it
# reported above until its shell is back at a prompt.
if (-not ($env:TMUX -or $env:STY)) {
    $Global:_waveterm_si_promptmark_inner = if (Test-Path Function:\prompt) { $function:prompt } else { $null }
    function Global:prompt {
        try { [Console]::Write([char]27 + ']16162;A' + [char]7) } catch {}
        if ($Global:_waveterm_si_promptmark_inner) {
            & $Global:_waveterm_si_promptmark_inner
        } else {
            "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
        }
    }
}

if ($PSVersionTable.PSVersion.Major -lt 7) {
    return  # skip OSC setup entirely
}

if ($PSStyle.FileInfo.Directory -eq "`e[44;1m") {
    $PSStyle.FileInfo.Directory = "`e[34;1m"
}

$Global:_WAVETERM_SI_FIRSTPROMPT = $true

# shell integration
function Global:_waveterm_si_blocked {
    # Check if we're in tmux or screen
    return ($env:TMUX -or $env:STY -or $env:TERM -like "tmux*" -or $env:TERM -like "screen*")
}

function Global:_waveterm_si_osc7 {
    if (_waveterm_si_blocked) { return }
    
    # Percent-encode the raw path as-is (handles UNC, drive letters, etc.)
    $encoded_pwd = [System.Uri]::EscapeDataString($PWD.Path)
    
    # OSC 7 - current directory
    Write-Host -NoNewline "`e]7;file://localhost/$encoded_pwd`a"
}

function Global:_waveterm_si_prompt {
    if (_waveterm_si_blocked) { return }
    
    if ($Global:_WAVETERM_SI_FIRSTPROMPT) {
		# not sending uname
		       $shellversion = $PSVersionTable.PSVersion.ToString()
		       Write-Host -NoNewline "`e]16162;M;{`"shell`":`"pwsh`",`"shellversion`":`"$shellversion`",`"integration`":false}`a"
        $Global:_WAVETERM_SI_FIRSTPROMPT = $false
    }
    
    _waveterm_si_osc7
}

# Add the OSC 7 call to the prompt function
if (Test-Path Function:\prompt) {
    $global:_waveterm_original_prompt = $function:prompt
    function Global:prompt {
        _waveterm_si_prompt
        & $global:_waveterm_original_prompt
    }
} else {
    function Global:prompt {
        _waveterm_si_prompt
        "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
    }
}