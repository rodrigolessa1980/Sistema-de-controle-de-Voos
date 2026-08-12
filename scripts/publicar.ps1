<#
.SYNOPSIS
  Publica o projeto: autentica no GitHub, cadastra as chaves e dispara o deploy.

.DESCRIPTION
  Roteiro único para sair do estado atual (tudo pronto, nada publicado) até o
  sistema no ar. Cada passo checa se já foi feito antes de refazer.

  O único trecho que EXIGE interação é o `gh auth login`: ele abre o navegador
  ou pede um token, e não há como automatizar isso sem receber a credencial —
  o que seria pior.

.EXAMPLE
  ./scripts/publicar.ps1              # roteiro completo
  ./scripts/publicar.ps1 -Somente Chaves
#>

[CmdletBinding()]
param(
    [string] $Repo = 'rodrigolessa1980/Sistema-de-controle-de-Voos',

    [ValidateSet('Tudo', 'Chaves', 'Deploy', 'Verificar')]
    [string] $Somente = 'Tudo'
)

Set-StrictMode -Version Latest

function Passo([string] $numero, [string] $titulo) {
    Write-Host ''
    Write-Host "── $numero · $titulo " -ForegroundColor Cyan -NoNewline
    Write-Host ('─' * [Math]::Max(0, 60 - $titulo.Length)) -ForegroundColor DarkGray
}

function Resolver-Gh {
    $cmd = Get-Command gh -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    # O winget instala no escopo do usuário e só acrescenta ao PATH do PRÓXIMO
    # shell. Procurar direto evita exigir que a pessoa feche o terminal.
    $found = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" `
        -Recurse -Filter 'gh.exe' -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName

    return $found
}

<#
.SYNOPSIS
  Recupera do Git Credential Manager o token que o `git push` já usa.

.DESCRIPTION
  Quem clonou o repositório por HTTPS e autenticou uma vez já tem um token do
  GitHub guardado no cofre do Windows. Ele serve para a API — é o mesmo token
  que autoriza o push. Reaproveitá-lo evita o `gh auth login`, que é o único
  passo interativo deste roteiro.

  A leitura usa .NET em vez do pipe do PowerShell: no 5.1, canalizar string
  para a entrada de um executável nativo corrompe o texto, e o `git` responde
  "refusing to work with credential missing protocol field".

  O valor fica só em memória e nunca é impresso.
#>
function Get-TokenDoCofre {
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = 'git'
        $psi.Arguments = 'credential fill'
        $psi.RedirectStandardInput = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        # Sem isto, um cofre vazio abriria uma janela de login no meio do script.
        $psi.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
        $psi.EnvironmentVariables['GCM_INTERACTIVE'] = 'never'

        $proc = [System.Diagnostics.Process]::Start($psi)
        $proc.StandardInput.Write("protocol=https`nhost=github.com`n`n")
        $proc.StandardInput.Close()
        $saida = $proc.StandardOutput.ReadToEnd()
        $proc.WaitForExit(15000) | Out-Null

        foreach ($linha in ($saida -split "`r?`n")) {
            if ($linha -like 'password=*') { return $linha.Substring(9).Trim() }
        }
    } catch {
        # Sem cofre, sem git, sem problema: cai no `gh auth login`.
    }
    return $null
}

# ============================================================================
#  1. GitHub CLI
# ============================================================================

Passo '1' 'GitHub CLI'

$gh = Resolver-Gh

if (-not $gh) {
    Write-Host '  não encontrado — instalando no escopo do usuário...' -ForegroundColor Yellow
    winget install --id GitHub.cli --scope user --silent `
        --accept-package-agreements --accept-source-agreements | Out-Null
    $gh = Resolver-Gh
}

if (-not $gh) {
    throw 'Não consegui instalar o GitHub CLI. Instale manualmente: https://cli.github.com'
}

$env:PATH = "$(Split-Path $gh);$env:PATH"
Write-Host "  ok: $(& $gh --version | Select-Object -First 1)" -ForegroundColor Green

# ============================================================================
#  2. Autenticação  (ÚNICO passo interativo)
# ============================================================================

Passo '2' 'Autenticação'

& $gh auth status 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) {
    # Antes de mandar a pessoa para o navegador: o token do `git push` já serve.
    $doCofre = Get-TokenDoCofre
    if ($doCofre) {
        $env:GH_TOKEN = $doCofre
        & $gh auth status 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host '  usando a credencial que o git já tem guardada' -ForegroundColor Green
        } else {
            $env:GH_TOKEN = $null
        }
    }
}

if (-not $env:GH_TOKEN) {
    & $gh auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  não autenticado e sem credencial no cofre. Abrindo o login...' -ForegroundColor Yellow
        Write-Host '  Escolha: GitHub.com → HTTPS → autenticar pelo navegador.' -ForegroundColor DarkGray
        Write-Host ''

        & $gh auth login

        if ($LASTEXITCODE -ne 0) {
            throw 'Login nao concluido. Rode: gh auth login -- e execute este script de novo.'
        }
    }
}

$conta = (& $gh api user --jq '.login' 2>$null)
Write-Host "  autenticado como: $conta" -ForegroundColor Green

# Criar environment exige admin; cadastrar secret não — basta escrita em Actions.
$permissao = (& $gh api "repos/$Repo" --jq '.permissions.admin' 2>$null)
if ($permissao -ne 'true') {
    Write-Host "  AVISO: sem permissão de admin em $Repo." -ForegroundColor Yellow
    Write-Host '  As chaves ainda podem ser cadastradas, mas o environment' -ForegroundColor DarkGray
    Write-Host '  "production" e o required reviewer só o dono do repositório cria.' -ForegroundColor DarkGray
}

# ============================================================================
#  3. Chaves
# ============================================================================

if ($Somente -in @('Tudo', 'Chaves')) {
    Passo '3' 'Chaves (secrets e variables)'
    & "$PSScriptRoot\setup-github-secrets.ps1" -Repo $Repo
    if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
        throw 'Falha ao cadastrar as chaves.'
    }
}

# ============================================================================
#  4. Environment de produção
# ============================================================================

if ($Somente -in @('Tudo', 'Deploy')) {
    Passo '4' 'Environment de produção'

    $existe = & $gh api "repos/$Repo/environments/production" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host '  environment "production" já existe' -ForegroundColor Green
    } else {
        & $gh api --method PUT "repos/$Repo/environments/production" 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host '  environment "production" criado' -ForegroundColor Green
        } else {
            Write-Host '  NÃO criado: a API respondeu 403 (exige admin no repositório).' -ForegroundColor Yellow
            Write-Host '  O GitHub vai criá-lo sozinho no primeiro deploy, SEM proteção.' -ForegroundColor Yellow
        }
    }

    Write-Host '  AÇÃO DO DONO DO REPOSITÓRIO: marque "Required reviewers" em' -ForegroundColor Yellow
    Write-Host "  https://github.com/$Repo/settings/environments" -ForegroundColor Yellow
    Write-Host '  Sem isso, qualquer push em main publica direto em produção.' -ForegroundColor DarkGray
}

# ============================================================================
#  5. Deploy
# ============================================================================

if ($Somente -in @('Tudo', 'Deploy')) {
    Passo '5' 'Deploy'

    Write-Host '  disparando o workflow...' -ForegroundColor DarkGray
    & $gh workflow run deploy.yml --repo $Repo

    if ($LASTEXITCODE -eq 0) {
        Write-Host '  workflow disparado. Acompanhe com:' -ForegroundColor Green
        Write-Host "    gh run watch --repo $Repo" -ForegroundColor DarkGray
    } else {
        Write-Host '  não consegui disparar. Faça um push em main, ou use Actions -> Deploy.' -ForegroundColor Yellow
    }
}

# ============================================================================
#  6. Verificação
# ============================================================================

if ($Somente -in @('Tudo', 'Verificar')) {
    Passo '6' 'Verificação — está no ar?'

    $serverHost = (& $gh variable list --repo $Repo --json name, value 2>$null |
        ConvertFrom-Json | Where-Object { $_.name -eq 'SERVER_PUBLIC_HOST' }).value

    if (-not $serverHost) {
        # SERVER_HOST é secret e não pode ser lido de volta; usa o .env local.
        $envFile = Join-Path $PSScriptRoot '..\.env'
        if (Test-Path $envFile) {
            $linha = Select-String -Path $envFile -Pattern '^SERVER_HOST=(.*)$' |
                Select-Object -First 1
            if ($linha) { $serverHost = $linha.Matches[0].Groups[1].Value.Trim() }
        }
    }

    if (-not $serverHost) {
        Write-Host '  não descobri o host do servidor; verifique manualmente.' -ForegroundColor Yellow
        return
    }

    foreach ($alvo in @(
            @{ Nome = 'API  /api/health'; Url = "http://${serverHost}:1701/api/health" },
            @{ Nome = 'API  /api/ready '; Url = "http://${serverHost}:1701/api/ready" },
            @{ Nome = 'Web  /health    '; Url = "http://${serverHost}:1700/health" },
            @{ Nome = 'Web  /          '; Url = "http://${serverHost}:1700/" }
        )) {
        try {
            $r = Invoke-WebRequest -Uri $alvo.Url -TimeoutSec 10 -UseBasicParsing
            Write-Host "  $($alvo.Nome)  HTTP $($r.StatusCode)" -ForegroundColor Green
        } catch {
            Write-Host "  $($alvo.Nome)  FALHOU" -ForegroundColor Red
        }
    }
}

Write-Host ''
Write-Host 'Roteiro concluído.' -ForegroundColor Cyan
Write-Host ''
