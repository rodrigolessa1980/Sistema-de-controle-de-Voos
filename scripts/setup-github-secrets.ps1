<#
.SYNOPSIS
  Cadastra os Secrets e Variables de Actions do projeto no repositorio GitHub.

.DESCRIPTION
  Le as credenciais de infraestrutura do .env local, GERA na hora os segredos
  criptograficos da aplicacao (JWT, cookie, encryption key) e envia tudo para o
  repositorio via `gh`.

  Nenhum valor de segredo e impresso na tela nem gravado em arquivo. Os segredos
  gerados existem apenas dentro deste processo e no cofre do GitHub -- o .env
  local de desenvolvimento usa outros valores, de proposito.

.PREREQUISITOS
  1. GitHub CLI:   winget install --id GitHub.cli
  2. Autenticacao: gh auth login          (escopo `repo` e suficiente)
  3. Permissao de admin no repositorio (so admin cria secrets).

.EXAMPLE
  ./scripts/setup-github-secrets.ps1
  ./scripts/setup-github-secrets.ps1 -Environment production
  ./scripts/setup-github-secrets.ps1 -WhatIf
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $Repo = 'rodrigolessa1980/Sistema-de-controle-de-Voos',

    [string] $EnvFile = (Join-Path $PSScriptRoot '..\.env'),

    # Cadastra no GitHub Environment informado (ex.: production) em vez do nivel
    # do repositorio. Recomendado: mantem os secrets de deploy fora do alcance
    # de PRs de fork.
    [string] $Environment,

    # Regenera JWT/cookie/encryption mesmo que ja existam no repositorio.
    # Atencao: invalida todas as sessoes ativas.
    [switch] $RotateAppSecrets
)

Set-StrictMode -Version Latest

function Invoke-Gh {
    param([string[]] $GhArgs, [switch] $Quiet)
    $output = & gh @GhArgs
    if ($LASTEXITCODE -ne 0) {
        throw "gh $($GhArgs -join ' ') falhou com codigo $LASTEXITCODE"
    }
    if (-not $Quiet) { return $output }
}

# ---------------------------------------------------------------- pre-requisitos
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    # O winget instala no escopo do usuario e acrescenta o diretorio ao PATH,
    # mas so vale a partir do PROXIMO shell. Procurar direto evita exigir que a
    # pessoa feche e reabra o terminal.
    $fromWinget = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" `
        -Recurse -Filter 'gh.exe' -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty DirectoryName

    if ($fromWinget) {
        $env:PATH = "$fromWinget;$env:PATH"
        Write-Host "gh encontrado em $fromWinget" -ForegroundColor DarkGray
    } else {
        throw 'GitHub CLI nao encontrado. Instale com: winget install --id GitHub.cli --scope user'
    }
}

& gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'gh nao esta autenticado. Rode: gh auth login'
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Arquivo .env nao encontrado em: $EnvFile"
}

Write-Host "Repositorio: $Repo" -ForegroundColor Cyan
if ($Environment) { Write-Host "Environment: $Environment" -ForegroundColor Cyan }
Write-Host ''

# ------------------------------------------------------------------- ler o .env
$envMap = @{}
foreach ($line in (Get-Content -LiteralPath $EnvFile)) {
    $trimmed = $line.Trim()
    if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
    $idx = $trimmed.IndexOf('=')
    if ($idx -lt 1) { continue }
    $key = $trimmed.Substring(0, $idx).Trim()
    $val = $trimmed.Substring($idx + 1).Trim().Trim('"').Trim("'")
    $envMap[$key] = $val
}

function Get-EnvValue {
    param([string] $Name, [string] $Fallback)
    if ($envMap.ContainsKey($Name) -and -not [string]::IsNullOrWhiteSpace($envMap[$Name])) {
        return $envMap[$Name]
    }
    if ($PSBoundParameters.ContainsKey('Fallback')) { return $Fallback }
    throw "Variavel '$Name' ausente ou vazia no .env"
}

$mysqlHost = Get-EnvValue 'MYSQL_HOST'
$mysqlPort = Get-EnvValue 'MYSQL_PORT' '3306'
$mysqlUser = Get-EnvValue 'MYSQL_USER'
$mysqlPass = Get-EnvValue 'MYSQL_PASSWORD'
$mysqlDb   = Get-EnvValue 'MYSQL_DATABASE'

$serverHost = Get-EnvValue 'SERVER_HOST'
$serverUser = Get-EnvValue 'SERVER_USER'
$serverPass = Get-EnvValue 'SERVER_PASSWORD'

# Provedor de e-mail: obrigatorio para o aviso de nova solicitacao (PLANO.md 13).
# Enquanto nao houver provedor contratado, fica vazio e o secret nao e cadastrado.
$mailApiKey    = Get-EnvValue 'MAIL_API_KEY' ''
$mailProvider  = Get-EnvValue 'MAIL_PROVIDER' 'resend'
$mailFrom      = Get-EnvValue 'MAIL_FROM' ''
$mailFromName  = Get-EnvValue 'MAIL_FROM_NAME' 'Air Charter Manager'
$mailReplyTo   = Get-EnvValue 'MAIL_REPLY_TO' ''

# O .env atual usa as chaves em minusculas: porta_frontend / porta_backend.
$portFrontend = Get-EnvValue 'porta_frontend' '1700'
$portBackend  = Get-EnvValue 'porta_backend'  '1701'

# ------------------------------------------------------- montar a DATABASE_URL
# A senha entra percent-encoded: '@', ':', '/', '#' e '?' quebram a URL do Prisma.
$userEnc     = [System.Uri]::EscapeDataString($mysqlUser)
$passEnc     = [System.Uri]::EscapeDataString($mysqlPass)
$databaseUrl = "mysql://${userEnc}:${passEnc}@${mysqlHost}:${mysqlPort}/${mysqlDb}?connection_limit=10&pool_timeout=20&connect_timeout=10"

# ---------------------------------------------- gerar os segredos da aplicacao
function New-RandomBytes {
    param([int] $Count)
    $buffer = New-Object 'System.Byte[]' $Count
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return $buffer
}

function New-UrlSafeSecret {
    param([int] $Count)
    $b64 = [Convert]::ToBase64String((New-RandomBytes $Count))
    return $b64.Replace('+', '-').Replace('/', '_').TrimEnd('=')
}

function New-HexSecret {
    param([int] $Count)
    return (-join ((New-RandomBytes $Count) | ForEach-Object { $_.ToString('x2') }))
}

# --------------------------------------------------------------------- secrets
$secrets = [ordered]@{
    'MYSQL_HOST'         = $mysqlHost
    'MYSQL_PORT'         = $mysqlPort
    'MYSQL_USER'         = $mysqlUser
    'MYSQL_PASSWORD'     = $mysqlPass
    'MYSQL_DATABASE'     = $mysqlDb
    'DATABASE_URL'       = $databaseUrl
    'SERVER_HOST'        = $serverHost
    'SERVER_USER'        = $serverUser
    'SERVER_PASSWORD'    = $serverPass
    'JWT_ACCESS_SECRET'  = (New-UrlSafeSecret 48)
    'JWT_REFRESH_SECRET' = (New-UrlSafeSecret 48)
    'COOKIE_SECRET'      = (New-UrlSafeSecret 32)
    'ENCRYPTION_KEY'     = (New-HexSecret 32)
}

# A chave do provedor de e-mail so entra se ja houver provedor contratado.
if (-not [string]::IsNullOrWhiteSpace($mailApiKey)) {
    $secrets['MAIL_API_KEY'] = $mailApiKey
} else {
    Write-Host '  (MAIL_API_KEY vazia no .env: provedor de e-mail ainda nao definido)' -ForegroundColor DarkYellow
    Write-Host '  O aviso de nova solicitacao depende dela. Ver docs/PLANO.md secao 13.3.' -ForegroundColor DarkYellow
    Write-Host ''
}

# Trocar estes invalida todas as sessoes ativas e torna ilegivel qualquer dado
# cifrado com a chave anterior. Por isso sao preservados se ja existirem.
$appSecrets = @('JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECRET', 'ENCRYPTION_KEY')

$existing = @()
$listArgs = @('secret', 'list', '--repo', $Repo, '--json', 'name')
if ($Environment) { $listArgs += @('--env', $Environment) }
try {
    $raw = (Invoke-Gh -GhArgs $listArgs) -join ''
    if (-not [string]::IsNullOrWhiteSpace($raw)) {
        $existing = @((ConvertFrom-Json $raw) | ForEach-Object { $_.name })
    }
} catch {
    Write-Host '  (nao foi possivel listar secrets existentes; seguindo)' -ForegroundColor DarkGray
}

# ------------------------------------------------------------------- variables
$variables = [ordered]@{
    'PORT_FRONTEND'    = $portFrontend
    'PORT_BACKEND'     = $portBackend
    'SERVER_APP_DIR'   = '/opt/aircharter'
    'POLL_INTERVAL_MS' = '10000'
    'TZ'               = 'America/Sao_Paulo'
    'NODE_ENV'         = 'production'
    'MAIL_PROVIDER'    = $mailProvider
    'MAIL_FROM_NAME'   = $mailFromName
}

# Endereços só entram se preenchidos — variable vazia no GitHub confunde mais
# do que ajuda.
if (-not [string]::IsNullOrWhiteSpace($mailFrom))    { $variables['MAIL_FROM'] = $mailFrom }
if (-not [string]::IsNullOrWhiteSpace($mailReplyTo)) { $variables['MAIL_REPLY_TO'] = $mailReplyTo }

# ----------------------------------------------------------------------- enviar
Write-Host 'Secrets:' -ForegroundColor White
$created = 0
$skipped = 0

foreach ($name in $secrets.Keys) {
    $isAppSecret = $appSecrets -contains $name
    $alreadyThere = $existing -contains $name

    if ($isAppSecret -and $alreadyThere -and -not $RotateAppSecrets) {
        Write-Host "  = $name (ja existe, preservado)" -ForegroundColor DarkGray
        $skipped++
        continue
    }

    if ($PSCmdlet.ShouldProcess("$Repo :: secret $name", 'gh secret set')) {
        $ghArgs = @('secret', 'set', $name, '--repo', $Repo, '--body', $secrets[$name])
        if ($Environment) { $ghArgs += @('--env', $Environment) }
        Invoke-Gh -GhArgs $ghArgs -Quiet
        Write-Host "  + $name" -ForegroundColor Green
        $created++
    }
}

Write-Host ''
Write-Host 'Variables:' -ForegroundColor White
foreach ($name in $variables.Keys) {
    if ($PSCmdlet.ShouldProcess("$Repo :: variable $name", 'gh variable set')) {
        $ghArgs = @('variable', 'set', $name, '--repo', $Repo, '--body', $variables[$name])
        if ($Environment) { $ghArgs += @('--env', $Environment) }
        Invoke-Gh -GhArgs $ghArgs -Quiet
        Write-Host "  + $name = $($variables[$name])" -ForegroundColor Green
    }
}

Write-Host ''
Write-Host "Secrets cadastrados: $created   preservados: $skipped" -ForegroundColor Cyan
Write-Host "Variables cadastradas: $($variables.Count)" -ForegroundColor Cyan
Write-Host ''
Write-Host "Confira em: https://github.com/$Repo/settings/secrets/actions"
Write-Host ''
Write-Host 'Lembrete de seguranca: a senha do MySQL e a senha de root do servidor' -ForegroundColor Yellow
Write-Host 'sao a MESMA hoje. Rotacione as duas e use um usuario de deploy nao-root.' -ForegroundColor Yellow
