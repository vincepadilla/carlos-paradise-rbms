param(
    [string]$PostgresBin = 'C:\Program Files\PostgreSQL\16\bin',
    [switch]$SkipBenchmark,
    [switch]$Readiness,
    [switch]$BenchmarkOnly
)

$ErrorActionPreference = 'Stop'
if ($BenchmarkOnly -and (-not $Readiness -or $SkipBenchmark)) {
    throw 'BenchmarkOnly requires Readiness and cannot be combined with SkipBenchmark.'
}
$apiRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$runId = [guid]::NewGuid().ToString('N')
$runRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot "rbms-step4a-$runId"))
$dataRoot = Join-Path $runRoot 'data'
$manifestPath = Join-Path $runRoot 'manifest.json'
$initdb = Join-Path $PostgresBin 'initdb.exe'
$pgctl = Join-Path $PostgresBin 'pg_ctl.exe'
$postgres = [IO.Path]::GetFullPath((Join-Path $PostgresBin 'postgres.exe'))
$originalManifest = $env:RBMS_STEP4A_MANIFEST
$started = $false
$resultCode = 1

# This runner is invoked in its own child PowerShell process. Clear libpq overrides
# without reading their values, so inherited connection/credential sources cannot route tests.
foreach ($variableName in @('PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD',
    'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGSYSCONFDIR', 'PGOPTIONS', 'PGSSLMODE',
    'PGSSLKEY', 'PGSSLCERT', 'PGSSLROOTCERT', 'PGSSLCRL', 'PGSSLCRLDIR', 'PGTARGETSESSIONATTRS')) {
    [Environment]::SetEnvironmentVariable($variableName, $null, 'Process')
}

function Assert-OwnedRoot {
    $resolvedRoot = [IO.Path]::GetFullPath($runRoot)
    if ((Split-Path -Parent $resolvedRoot) -ne $tempRoot -or
        (Split-Path -Leaf $resolvedRoot) -ne "rbms-step4a-$runId" -or
        [IO.Path]::GetFullPath($dataRoot) -ne (Join-Path $resolvedRoot 'data')) {
        throw 'Refusing an out-of-scope disposable cluster path.'
    }
    if (Test-Path -LiteralPath $resolvedRoot) {
        if ((Get-Item -LiteralPath $resolvedRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Refusing a reparse-point fixture root.'
        }
    }
}

Assert-OwnedRoot
foreach ($binary in @($initdb, $pgctl, $postgres)) {
    if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw 'PostgreSQL fixture binaries are unavailable.' }
}
if (Test-Path -LiteralPath $runRoot) { throw 'Refusing a pre-existing fixture directory.' }
New-Item -ItemType Directory -Path $runRoot | Out-Null
Set-Content -LiteralPath (Join-Path $runRoot 'owner.txt') -Value $runId -Encoding ASCII
Set-Content -LiteralPath (Join-Path $runRoot 'empty-passfile') -Value '' -Encoding ASCII
Set-Content -LiteralPath (Join-Path $runRoot 'empty-servicefile') -Value '' -Encoding ASCII
$env:PGPASSFILE = Join-Path $runRoot 'empty-passfile'
$env:PGSERVICEFILE = Join-Path $runRoot 'empty-servicefile'

try {
    # The OS selects a free loopback port; retrying an existing service is never allowed.
    do {
        $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
        $listener.Start()
        $fixturePort = $listener.LocalEndpoint.Port
        $listener.Stop()
    } while ($fixturePort -lt 49152)

    & $initdb -D $dataRoot --username=rbms_step4a_fixture --auth=trust --encoding=UTF8 --no-locale 2>&1 |
        Out-File -LiteralPath (Join-Path $runRoot 'initdb.log') -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw 'Fresh PostgreSQL initialization failed.' }
    # pg_ctl detaches its own background server; no interactive GUI or Windows service is created.
    & $pgctl -D $dataRoot -l (Join-Path $runRoot 'postgres.log') -w -t 20 -o "-h 127.0.0.1 -p $fixturePort -c max_connections=16 -c shared_buffers=32MB -c autovacuum=off" start
    if ($LASTEXITCODE -ne 0) { throw 'Disposable server did not start; no DB connection will be attempted.' }
    $started = $true
    $pidLines = Get-Content -LiteralPath (Join-Path $dataRoot 'postmaster.pid')
    $fixtureProcessId = [int]$pidLines[0]
    if ([int]$pidLines[3] -ne $fixturePort -or
        [IO.Path]::GetFullPath((Get-Process -Id $fixtureProcessId).Path) -ne $postgres) {
        throw 'Disposable server process identity does not match.'
    }
    $ownedListener = @(Get-NetTCPConnection -State Listen -LocalPort $fixturePort |
        Where-Object { $_.OwningProcess -eq $fixtureProcessId -and $_.LocalAddress -eq '127.0.0.1' })
    if ($ownedListener.Count -ne 1) { throw 'Cannot independently verify ownership of the disposable listener.' }
    @{
        process_verified = $true
        pid = $fixtureProcessId
        port = $fixturePort
        data_directory = $dataRoot
        database = "rbms_step4a_$runId"
        nonce = $runId
    } | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding ASCII
    $env:RBMS_STEP4A_MANIFEST = $manifestPath
    Write-Output 'Fresh cluster process, loopback listener and data directory independently verified.'
    Push-Location $apiRoot
    try {
        & php tests/Postgres/bootstrap-fixture.php
        if ($LASTEXITCODE -ne 0) { throw 'Disposable database verification/bootstrap failed.' }
        if ($BenchmarkOnly) {
            $resultCode = 0
        } elseif ($Readiness) {
            # Every database-writing test in this step uses the owned PostgreSQL fixture.
            & php vendor/phpunit/phpunit/phpunit --do-not-cache-result tests/Postgres
        } else {
            & php -d extension=pdo_sqlite vendor/phpunit/phpunit/phpunit --do-not-cache-result tests/Postgres/ReservationAvailabilityPostgresTest.php
        }
        if (-not $BenchmarkOnly) { $resultCode = $LASTEXITCODE }
        if ($resultCode -eq 0 -and -not $SkipBenchmark) {
            if ($Readiness) {
                & php tests/Postgres/measure-readiness.php
            } else {
                & php tests/Postgres/measure-shadow.php
            }
            $resultCode = $LASTEXITCODE
        }
    } finally {
        Pop-Location
    }
} finally {
    $env:RBMS_STEP4A_MANIFEST = $originalManifest
    Assert-OwnedRoot
    if ((Get-Content -LiteralPath (Join-Path $runRoot 'owner.txt') -Raw).Trim() -ne $runId) {
        throw 'Refusing cleanup without the fixture ownership marker.'
    }
    $stopped = -not $started
    if ($started -or (Test-Path -LiteralPath (Join-Path $dataRoot 'postmaster.pid'))) {
        & $pgctl -D $dataRoot -m fast -w -t 20 stop
        $stopped = $LASTEXITCODE -eq 0
    }
    if (-not $stopped) { throw "Owned fixture could not be stopped; retained at $runRoot" }
    # Recursive cleanup is limited to this verified, uniquely-created temporary root.
    Assert-OwnedRoot
    Remove-Item -LiteralPath $runRoot -Recurse -Force
    Write-Output 'Disposable PostgreSQL cluster stopped and its owned temporary directory removed.'
}
exit $resultCode
