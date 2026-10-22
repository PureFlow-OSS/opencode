param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Path
)

$ErrorActionPreference = "Stop"

if (-not $Path -or $Path.Count -eq 0) { throw "At least one path is required" }

function Get-ConfiguredValue {
  param(
    [Parameter(Mandatory = $true)]
    [string[]] $Names
  )

  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { return $value }
  }
  return $null
}

function Get-ResolvedFiles {
  param(
    [Parameter(Mandatory = $true)]
    [string[]] $InputPath
  )

  @(
    $InputPath | ForEach-Object {
      $item = Get-Item -LiteralPath $_ -ErrorAction Stop
      if ($item.PSIsContainer) {
        Get-ChildItem -LiteralPath $item.FullName -Recurse -File |
          Where-Object { $_.Extension -in @(".exe", ".dll") } |
          Select-Object -ExpandProperty FullName
        return
      }
      $item.FullName
    } | Sort-Object -Unique
  )
}

$keyVault = @{
  vaultUrl = Get-ConfiguredValue @("AZURE_KEYVAULT_URL", "KEYVAULT_URL")
  clientId = Get-ConfiguredValue @("AZURE_KEYVAULT_CLIENT_ID", "AZURE_CLIENT_ID")
  clientSecret = Get-ConfiguredValue @("AZURE_KEYVAULT_CLIENT_SECRET", "AZURE_CLIENT_SECRET")
  tenantId = Get-ConfiguredValue @("AZURE_KEYVAULT_TENANT_ID", "AZURE_TENANT_ID")
  certificate = Get-ConfiguredValue @("AZURE_KEYVAULT_CERT", "CERT_ALIAS", "CertificateName")
}
$trustedSigning = @{
  endpoint = Get-ConfiguredValue @("AZURE_TRUSTED_SIGNING_ENDPOINT")
  account = Get-ConfiguredValue @("AZURE_TRUSTED_SIGNING_ACCOUNT_NAME")
  profile = Get-ConfiguredValue @("AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE")
}

$keyVaultComplete = @($keyVault.Values | Where-Object { $_ }).Count -eq $keyVault.Count
$trustedSigningComplete = @($trustedSigning.Values | Where-Object { $_ }).Count -eq $trustedSigning.Count
$hasSigningInput = @($keyVault.Values + $trustedSigning.Values | Where-Object { $_ }).Count -gt 0

if (-not ($keyVaultComplete -or $trustedSigningComplete)) {
  if ($hasSigningInput) { throw "Windows signing configuration is incomplete" }
  Write-Host "No Windows signing configuration found; leaving the local package unsigned"
  exit 0
}

$files = Get-ResolvedFiles -InputPath $Path
if (-not $files -or $files.Count -eq 0) { throw "No files matched the requested paths" }

if ($keyVaultComplete) {
  $tool = Get-Command AzureSignTool -ErrorAction SilentlyContinue
  if (-not $tool) { throw "AzureSignTool was not found. Install it with: dotnet tool install --global AzureSignTool" }

  $timestampUrl = Get-ConfiguredValue @("AZURE_TIMESTAMP_URL", "TIMESTAMP_URL")
  if (-not $timestampUrl) { $timestampUrl = "http://timestamp.digicert.com" }

  $arguments = @(
    "sign",
    "--azure-key-vault-url", $keyVault.vaultUrl,
    "--azure-key-vault-client-id", $keyVault.clientId,
    "--azure-key-vault-client-secret", $keyVault.clientSecret,
    "--azure-key-vault-tenant-id", $keyVault.tenantId,
    "--azure-key-vault-certificate", $keyVault.certificate,
    "--file-digest", "SHA256",
    "--timestamp-rfc3161", $timestampUrl,
    "--timestamp-digest", "SHA256",
    "--verbose"
  )
  foreach ($file in $files) {
    for ($attempt = 1; $attempt -le 5; $attempt++) {
      $output = @(& $tool.Source @arguments $file 2>&1)
      $signingExitCode = $LASTEXITCODE
      $output | ForEach-Object { Write-Host $_ }
      if ($signingExitCode -eq 0) { break }

      # AzureSignTool's exit code only says signing failed; retry the underlying sharing violation alone.
      $sharingViolation = ($output -join "`n") -match '(?im)^\s*Signing failed with error (?:0x)?80070020\.\s*$'
      if (-not $sharingViolation -or $attempt -eq 5) {
        throw "AzureSignTool exited with status $signingExitCode for $file after $attempt attempt(s)"
      }
      Write-Host "Installer file is in use (80070020); retrying signing in 2 seconds ($attempt/5): $file"
      Start-Sleep -Seconds 2
    }
  }
  exit 0
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

Invoke-TrustedSigning @{
  Endpoint = $trustedSigning.endpoint
  CodeSigningAccountName = $trustedSigning.account
  CertificateProfileName = $trustedSigning.profile
  Files = ($files -join ",")
  FileDigest = "SHA256"
  TimestampDigest = "SHA256"
  TimestampRfc3161 = "http://timestamp.acs.microsoft.com"
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
if (-not $?) { throw "TrustedSigning command failed" }
