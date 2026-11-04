param(
  [string]$CertificateDirectory = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex/secrets/opencode-updater-local-tls')
)

$ErrorActionPreference = 'Stop'
$directory = [IO.Path]::GetFullPath($CertificateDirectory)
New-Item -ItemType Directory -Path $directory -Force | Out-Null

# Reuse the development certificate; this command does not change the trust store.
& dotnet dev-certs https --export-path (Join-Path $directory 'localhost.pem') --format PEM --no-password | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Could not export the localhost development certificate.' }

$source = Join-Path (Split-Path -Parent $PSScriptRoot) 'admin-ui/nginx.conf'
$configuration = [IO.File]::ReadAllText($source).Replace('listen 80;', @'
listen 443 ssl;
  ssl_certificate /etc/nginx/opencode-tls/localhost.pem;
  ssl_certificate_key /etc/nginx/opencode-tls/localhost.key;
  ssl_protocols TLSv1.2 TLSv1.3;
'@)
$configuration += @'

server {
  listen 80;
  server_name _;
  return 308 https://localhost$request_uri;
}

server {
  listen 444 ssl;
  ssl_certificate /etc/nginx/opencode-tls/localhost.pem;
  ssl_certificate_key /etc/nginx/opencode-tls/localhost.key;
  ssl_protocols TLSv1.2 TLSv1.3;
  server_name _;
  return 308 https://localhost$request_uri;
}
'@
[IO.File]::WriteAllText((Join-Path $directory 'nginx.conf'), $configuration, [Text.UTF8Encoding]::new($false))
Write-Host 'Local HTTPS prepared for https://localhost (port 443). Certificate and key stay outside the repository.'
Write-Output $directory.Replace('\', '/')
