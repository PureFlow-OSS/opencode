param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Path
)

$ErrorActionPreference = "Stop"

if (-not $Path -or $Path.Count -eq 0) {
  throw "At least one path is required"
}

function Get-ResolvedFiles {
  param(
    [Parameter(Mandatory = $true)]
    [string[]] $InputPath
  )

  @(
    $InputPath | ForEach-Object {
      $item = Get-Item $_ -ErrorAction SilentlyContinue
      if (-not $item) { continue }
      if ($item.PSIsContainer) {
        Get-ChildItem -LiteralPath $item.FullName -Recurse -File |
          Where-Object { $_.Extension -in @(".exe", ".dll") } |
          Select-Object -ExpandProperty FullName
        continue
      }

      $item.FullName
    } | Sort-Object -Unique
  )
}

function Sign-WithTrustedSigning {
  param(
    [Parameter(Mandatory = $true)]
    [string[]] $Files
  )

  $vars = @{
    endpoint = $env:AZURE_TRUSTED_SIGNING_ENDPOINT
    account = $env:AZURE_TRUSTED_SIGNING_ACCOUNT_NAME
    profile = $env:AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE
  }

  if ($vars.Values | Where-Object { -not $_ }) {
    throw "Azure Trusted Signing is not configured"
  }

  $moduleVersion = "0.5.8"
  $module = Get-Module -ListAvailable -Name TrustedSigning | Where-Object { $_.Version -eq [version] $moduleVersion }

  if (-not $module) {
    try {
      Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null
    }
    catch {
      Write-Host "NuGet package provider install skipped: $($_.Exception.Message)"
    }

    Install-Module -Name TrustedSigning -RequiredVersion $moduleVersion -Force -Repository PSGallery -Scope CurrentUser
  }

  Import-Module TrustedSigning -RequiredVersion $moduleVersion -Force

  TrustedSigning\Invoke-TrustedSigning @{
    Endpoint = $vars.endpoint
    CodeSigningAccountName = $vars.account
    CertificateProfileName = $vars.profile
    Files = ($Files -join ",")
    FileDigest = "SHA256"
    TimestampDigest = "SHA256"
    TimestampRfc3161 = $env:AZURE_TIMESTAMP_URL ?? "http://timestamp.acs.microsoft.com"
    ExcludeEnvironmentCredential = $true
    ExcludeWorkloadIdentityCredential = $true
    ExcludeManagedIdentityCredential = $true
    ExcludeSharedTokenCacheCredential = $true
    ExcludeVisualStudioCredential = $true
    ExcludeVisualStudioCodeCredential = $true
    ExcludeAzureCliCredential = $false
    ExcludeAzurePowerShellCredential = $true
    ExcludeAzureDeveloperCliCredential = $true
    ExcludeInteractiveBrowserCredential = $true
  }
}

function Invoke-KeyVaultSigning {
  param(
    [Parameter(Mandatory = $true)]
    [string[]] $Files
  )

  $vars = @{
    vaultUrl = $env:AZURE_KEYVAULT_URL ?? $env:KEYVAULT_URL
    clientId = $env:AZURE_KEYVAULT_CLIENT_ID ?? $env:AZURE_CLIENT_ID
    clientSecret = $env:AZURE_KEYVAULT_CLIENT_SECRET ?? $env:AZURE_CLIENT_SECRET
    tenantId = $env:AZURE_KEYVAULT_TENANT_ID ?? $env:AZURE_TENANT_ID
    certificate = $env:AZURE_KEYVAULT_CERT ?? $env:CERT_ALIAS ?? $env:CertificateName
    timestampUrl = $env:AZURE_TIMESTAMP_URL ?? $env:TIMESTAMP_URL ?? "http://timestamp.digicert.com"
  }

  if ($vars.Values | Where-Object { -not $_ }) {
    throw "Azure Key Vault signing is not configured"
  }

  $tool = Get-Command AzureSignTool -ErrorAction SilentlyContinue
  if (-not $tool) {
    throw "AzureSignTool was not found. Install it with: dotnet tool install --global AzureSignTool"
  }

  $arguments = @(
    "sign"
    "--azure-key-vault-url"; $vars.vaultUrl
    "--azure-key-vault-client-id"; $vars.clientId
    "--azure-key-vault-client-secret"; $vars.clientSecret
    "--azure-key-vault-tenant-id"; $vars.tenantId
    "--azure-key-vault-certificate"; $vars.certificate
    "--file-digest"; "SHA256"
    "--timestamp-rfc3161"; $vars.timestampUrl
    "--timestamp-digest"; "SHA256"
    "--verbose"
  ) + $Files

  & $tool.Source @arguments
}

$files = Get-ResolvedFiles -InputPath $Path
if (-not $files -or $files.Count -eq 0) {
  throw "No files matched the requested paths"
}

if (
  ($env:AZURE_KEYVAULT_URL -or $env:KEYVAULT_URL) -and
  ($env:AZURE_KEYVAULT_CLIENT_ID -or $env:AZURE_CLIENT_ID) -and
  ($env:AZURE_KEYVAULT_CLIENT_SECRET -or $env:AZURE_CLIENT_SECRET) -and
  ($env:AZURE_KEYVAULT_TENANT_ID -or $env:AZURE_TENANT_ID) -and
  ($env:AZURE_KEYVAULT_CERT -or $env:CERT_ALIAS -or $env:CertificateName)
) {
  Invoke-KeyVaultSigning -Files $files
  exit 0
}

if ($env:AZURE_TRUSTED_SIGNING_ENDPOINT -and $env:AZURE_TRUSTED_SIGNING_ACCOUNT_NAME -and $env:AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE) {
  Sign-WithTrustedSigning -Files $files
  exit 0
}

throw "No signing configuration found. Set Azure Key Vault or Azure Trusted Signing environment variables."
