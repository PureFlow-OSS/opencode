# Gezielter Port auf v2.1.2

Branch: `feat/merge-upstream-v2.1.2`.
Grundlage ist der vollständige Upstream-Baum von `v2.1.2` (`a517687fde`),
übernommen mit `04b4387060`. Die alte Fork-Historie bleibt erhalten.
Quellstand des Forks: `7bf0d56aa0`; zusätzlich wurden die beim Start noch
uncommitteten Unternehmenskonfigurations- und Updater-Fixes berücksichtigt.

Die Arbeiten liegen im angehängten Worktree
`C:\Users\Klaus\.codex\worktrees\merge-upstream\opencode`.
Der ursprüngliche Checkout und dessen offene Arbeiten wurden erhalten.

## Übernommene Funktionen

- **AI Factory:** native V2-Integration mit gespeicherten Zugangsdaten,
  Umgebungs- und vertrauenswürdigen Konfigurationsschlüsseln, authentifizierter
  Modell-Discovery, Modellkarten-Fallback, Modellregeln, Sichtbarkeit und Varianten.
  Schlüssel bleiben aus dem Provider-/Modellkatalog heraus und werden beim Request gesetzt.
- **Proxy und Managed Config:** zentrale Defaults unterhalb lokaler und verwalteter
  Einstellungen; systemweite MDM-Priorität bleibt erhalten. Projektkonfiguration
  darf Unternehmens-Endpunkte für gespeicherte Schlüssel nicht umleiten.
  Proxy-Routing, Ausnahmen, deaktivierter Proxy sowie MCP-Kindprozesse und npm
  berücksichtigen dieselbe Konfiguration unter Bun und Node.
- **Dateitools:** Read, Edit, Write und Patch erhalten UTF-8/BOM und Windows-1252.
  Nicht darstellbare Zeichen werden vor dem Schreiben abgewiesen. UTF-8-Zeichen
  an Lesegrenzen und BOM-Marker in späteren Zeilen bleiben korrekt.
- **Websuche:** Exa/Parallel auf der V2-Registry, bestehender
  `OPENCODE_WEBSEARCH_PROVIDER`-Override, Session-/Modellkontext für Parallel und
  Windows-Proxy-Anmeldung über `-ProxyUseDefaultCredentials`. Dynamische Daten
  einschließlich Schlüsseln gehen über stdin, nicht über die Prozessargumente.
- **Desktop-Updater:** authentifizierte Unternehmens-Metadaten und Downloads,
  vertrauenswürdige Feed-URLs, direkte Electron-Update-Session und Windows-Helfer
  aus einem temporären Verzeichnis. Der Helfer prüft den festen Installationspfad
  und einen außerhalb liegenden Installer vor dem Aufräumen; NSIS erhält `/D=` zuletzt.
  Release-ZIP und Update-Server einschließlich MCP-Store-Verwaltung sind übernommen.
- **MCP-Einstellungen und Store:** Installation, Bearbeitung und Entfernung werden
  dauerhaft gespeichert und mit dem laufenden MCP abgeglichen. Managed-Einträge
  bleiben geschützt; PAT und OAuth bleiben verfügbar. Ein ausdrücklich leerer
  `x-litellm-api-key` wird erst zur Laufzeit gefüllt und bei Kontowechsel erneuert.
- **Session-Renaming:** kein alter Produktionspatch notwendig. Upstream verlangt
  bereits keine Tool-Berechtigungsabfrage und schützt manuelle Titel während einer
  automatischen Titelgenerierung. Der reale CodeMode-Aufruf ist gegen Regression gesichert.

Eigene Kostenanzeige, Composer-Anpassungen und weitere alte UI-Anpassungen wurden
nicht portiert. Alte Feedback-Formulare im Desktop wurden nicht wieder aktiviert.

## Verifikation

Alle Bun-Prüfungen verwenden die von Upstream geforderte Version **1.4.2**.
Tests laufen aus den jeweiligen Paketverzeichnissen.

| Prüfung | Ergebnis |
| --- | --- |
| Repository `bun --bun run check` | Lint ohne Fehler; **34/34** Typprüfungen erfolgreich |
| Config, zentrale Defaults, Vertrauensgrenzen und Rename-Tool | **58 bestanden**, ein bestehender Skip |
| MCP-Runtime, OAuth und verwalteter Store | **100 bestanden**, ein bestehender Skip |
| Dateimutation, Read/Edit/Write/Patch | **111 bestanden** |
| Encoding-/BOM-Helfer | **4 bestanden**, einschließlich Byte-Roundtrip |
| Automatische und manuelle Session-Titel | **15 bestanden** |
| AI-Factory-Provider | **6 bestanden** |
| Websearch-Registry und Provider | **13 bestanden** |
| Reale Windows-PowerShell-Suche über lokalen Test-Proxy | **1 bestanden**, Authentifizierung und UTF-8 geprüft |
| Proxy unter Bun/Node, Kindprozesse und npm | **7 bestanden** |
| MCP-Modelle und Operationen / Settings-Routen | **9 / 7 bestanden** |
| Browser: Store-Eintrag bearbeiten, lokale Argumente und Optionen erhalten | **2 bestanden**, Fehler vor der Korrektur reproduziert |
| Updater-Zustandsautomat und Unternehmens-Metadaten | **26 bestanden** |
| Desktop-Konfiguration einschließlich eingebetteter Update-URL | **11 bestanden** |
| Unternehmens-Release-Archiv aus getrennten CI-Artefakten | **2 bestanden** |

Der öffentliche Client wurde nach den Protocol-/HttpApi-Änderungen mit
`bun run generate` in `packages/client` regeneriert; generierte Dateien wurden
nicht von Hand verändert.

Der native Windows-x64-Baseline-CLI-Build mit eingebetteter Web-Oberfläche ist
erfolgreich. Die kompilierte EXE bestand zusätzlich einen vollständigen isolierten
AI-Factory-SSE-/Tool-Test mit zwei Provider-Turns und echter CodeMode-Ausführung.
Der Desktop-Produktionsbuild mit dieser lokalen CLI sowie Main, Preload, Renderer
und dem selbständig ausführbaren Windows-Helfer ist ebenfalls erfolgreich.
Update-Server und Helfer bauen mit .NET 10.

Unter Windows mussten die von Git als Text ausgecheckten Upstream-Symlinks im
Worktree wiederhergestellt werden. Eine unvollständig entpackte SolidStart-Abhängigkeit
wurde aus exakt dem per Lockfile-SHA512 geprüften Archiv repariert. Dabei wurden
keine Abhängigkeitsversionen oder globalen Git-Einstellungen geändert.

## Verbleibende Prüfung und Grenzen

### Lokaler Windows-Build

Der Einstieg `script/package-desktop-electron-win.ps1 -WorkingDirectory ./packages/desktop`
ist auf V2 portiert. Ohne explizites `OPENCODE_CLI_DIST` baut er die lokale Windows-x64-Baseline-CLI;
bei Wiederverwendung müssen CLI- und Desktop-Version übereinstimmen. Er verwendet Bun 1.4.2,
baut Desktop und Helfer und paketiert ohne Veröffentlichung. Selbst gesetzte Versions- und
CLI-Variablen werden danach wiederhergestellt.

Key-Vault-Aliase (`KEYVAULT_URL`, `CERT_ALIAS`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
`AZURE_TENANT_ID`) funktionieren auch lokal. Signierung erfolgt vor dem Erzeugen der
Update-Metadaten mit SHA-256. Unvollständige Signierkonfiguration und Werkzeugfehler brechen ab.
`OPENCODE_ELECTRON_OUTPUT_DIR` steuert die Ausgabe; Update-URL und Windows-Cachepfad werden
in den Desktop eingebettet. Der Cachepfad kann `C:/Entwicklung` sein und bleibt außerhalb
des vom Helfer bereinigten Installationsverzeichnisses.

Verifiziert: vollständiger unsignierter PowerShell-Build mit vorhandener lokaler V2-CLI,
NSIS-Installer (281.369.216 Bytes), Blockmap und `latest.yml`; SHA-512 und Größe stimmen
mit den Metadaten überein. Alle 646 Main-Prozess-Chunks im App-Archiv stimmen mit der
Build-Ausgabe überein; lokale Update-URL und Cachepfad sind enthalten. Zusätzlich bestehen
13 Desktop-Konfigurationstests, vier Cachetests, vier Signierszenarien mit lokalem Testwerkzeug,
beide PowerShell-Parserprüfungen und der Fehlerfall zur Wiederherstellung der Shell-Umgebung.
Der vollständige Repository-Check besteht mit 34 erfolgreichen Typprüfungen.

Eine echte Key-Vault-Signierung und ein Installationslauf wurden nicht ausgeführt.

### Weitere Grenzen

- Die Provider-, Proxy- und Store-Netzwerktests verwenden lokale Test-Server.
  Ein produktiver Aufruf im Unternehmensnetz wurde nicht ausgeführt.
- Desktop und Helfer wurden gebaut; der NSIS-Installer wurde nicht ausgeführt und
  kein Desktop-Update tatsächlich installiert. Die Release-Workflows wurden lokal
  geprüft und nicht auf GitHub ausgeführt.
- Die Updater-Brücke verwendet den aktiven gespeicherten/migrierten AI-Factory-Schlüssel
  oder `OPENCODE_AIFACTORY_API_KEY`; direkt in Provider-Konfiguration hinterlegte
  Schlüssel werden dort nicht gesondert ausgelesen.
- Der übernommene Update-Server meldet weiterhin eine vorhandene NuGet-Warnung zu
  `SQLitePCLRaw.lib.e_sqlite3` 2.1.11
  ([Advisory](https://github.com/advisories/GHSA-2m69-gcr7-jv3q)). Die native
  SQLite-Paketmigration ist offen. Die andere gemeldete transitive Abhängigkeit
  `Microsoft.OpenApi` wurde auf die korrigierte Version 2.7.5 festgelegt
  ([Advisory](https://github.com/advisories/GHSA-v5pm-xwqc-g5wc)).

Es wurde nichts gepusht, veröffentlicht, installiert oder am laufenden Desktop
beziehungsweise dessen Server neu gestartet.
