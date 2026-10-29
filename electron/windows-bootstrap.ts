// The vendor script remains unchanged. Its HTTP cmdlets use Windows curl to
// avoid legacy .NET download failures; vendor digest verification still runs.
export const windowsBootstrap = String.raw`param([Parameter(Mandatory=$true)][string]$InstallerPath)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
$curlPath = Join-Path $env:SystemRoot 'System32\curl.exe'

function Invoke-WebRequest {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$Uri, [string]$OutFile, [switch]$UseBasicParsing, [int]$TimeoutSec = 300)
    if (-not (Test-Path -LiteralPath $curlPath)) {
        return Microsoft.PowerShell.Utility\Invoke-WebRequest @PSBoundParameters
    }
    if (([Uri]$Uri).Scheme -ne 'https') { throw 'Installer downloads require HTTPS.' }
    Write-Host ('Downloading: ' + $Uri)
    $downloadUri = $Uri
    $curlArgs = @('--fail','--location','--silent','--show-error','--retry','3','--retry-all-errors','--retry-delay','2','--connect-timeout','15','--max-time',[string]$TimeoutSec)
    if ($env:TRINITY_DOWNLOAD_PROXY -and $env:TRINITY_DOWNLOAD_TOKEN) {
        $downloadUri = $env:TRINITY_DOWNLOAD_PROXY + '?url=' + [Uri]::EscapeDataString($Uri)
        $curlArgs += @('--proto','=http','--proto-redir','=http','--noproxy','127.0.0.1','--header',('Authorization: Bearer ' + $env:TRINITY_DOWNLOAD_TOKEN))
    } else { $curlArgs += @('--proto','=https','--proto-redir','=https') }
    $curlArgs += @('--url',$downloadUri)
    if ($OutFile) { $curlArgs += @('--output',$OutFile) }
    $stderrPath = Join-Path ([IO.Path]::GetTempPath()) ('trinity-download-' + [Guid]::NewGuid().ToString('N') + '.log')
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $content = & $curlPath @curlArgs 2> $stderrPath
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = $previousPreference
        if ($exitCode -ne 0) {
            $details = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { '' }
            throw ('HTTPS download failed (curl ' + $exitCode + '): ' + $details)
        }
        if (-not $OutFile) { return [pscustomobject]@{ Content = [string]::Join([Environment]::NewLine, [string[]]$content) } }
    } finally {
        $ErrorActionPreference = $previousPreference
        if (Test-Path -LiteralPath $stderrPath) { Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue }
    }
}
function Invoke-RestMethod {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$Uri, [int]$TimeoutSec = 300)
    $response = Invoke-WebRequest -Uri $Uri -TimeoutSec $TimeoutSec -UseBasicParsing
    try { return ($response.Content | ConvertFrom-Json -ErrorAction Stop) }
    catch { return $response.Content }
}
try {
    & $InstallerPath
    if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }
    exit 0
} catch {
    Write-Error ($_.Exception.Message) -ErrorAction Continue
    exit 1
}
`;
