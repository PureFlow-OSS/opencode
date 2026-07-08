# Merge Upstream Dev Rebuild Notes

## Ziel
Diese Datei dient als Wieder-Einbau-Plan für den Branch `feat/merge-upstream-dev`.
Sie beschreibt die Änderungen seit `ee4f46600344c47f69631597be5f549cb0bdb701` nach Feature-Blöcken, nicht nach Commits.

## Kurzfassung
- Größter Block: neue Updater- und Deployment-Infrastruktur, inklusive eigener Update-Server, Admin-UI, Windows-Signing, Reset-Flow und Beta-Rollout.
- Zweiter Block: Config-, Provider- und Proxy-Umstellung rund um RRZ AI Factory, managed Provider-Config und modellbezogene Sichtbarkeit.
- Dritter Block: UI- und Session-Workflows, vor allem MCP-Verwaltung, Model Switch Compaction, Followup/Todo/Permission UX und bessere Sync-Logik.
- Vierter Block: Tooling-Änderungen für Bash-Background-Jobs, Webfetch/Websearch-Proxying, Playwright und Attachment-Fallbacks.

## Copy-Paste Prompt Für Das Modell
Verwende diesen Prompt, wenn die Änderungen später erneut eingearbeitet werden sollen:

```text
Du arbeitest im Repo `C:\Users\Klaus\Desktop\PFH\opencode` auf dem Branch `feat/merge-upstream-dev`.

Aufgabe:
- Re-implementiere alle Änderungen, die seit `ee4f46600344c47f69631597be5f549cb0bdb701` entstanden sind.
- Orientiere dich an der Feature-Struktur unten, nicht an einzelnen Commits.
- Halte dich an die bestehende Codebase und den Stil im Repo.
- Verwende `apply_patch` für alle manuellen Dateiänderungen.
- Bevorzuge bestehende Patterns aus dem Repo, keine großen Architektur-Umbrüche.
- Wenn du etwas zurückbaust, stelle sicher, dass abhängige Flows, Tests und Typen ebenfalls wieder zusammenpassen.

Wichtige Leitplanken:
- `packages/opencode` ist der zentrale Kern für Config, Provider, Session, Tools und Server.
- `packages/app` enthält die Web-UI und die global-sync-/model-Selection-Logik.
- `packages/desktop` und `packages/desktop-electron` enthalten Tauri/Electron-spezifische Desktop- und Updater-Änderungen.
- Die neue RRZ-AI-Factory-Logik ist über Config, Provider, Update-Server und Modellsichtbarkeit verteilt.
- Tooling wie `bash_read`, `bash_stop`, `playwright`, `webfetch` und Proxy-Unterstützung muss zusammen gedacht werden.

Vorgehen:
1. Stelle die Config-/Provider-Basis wieder her.
2. Baue die UI-Änderungen für Settings, MCP, Models, Sessions und Composer nach.
3. Stelle die Tool- und Session-Änderungen wieder her.
4. Ziehe zuletzt Updater, Packaging und Desktop-IPC nach.
5. Prüfe alle betroffenen Tests und die Typen.
```

## Wieder-Einbau-Reihenfolge
1. Config, managed config, provider, model visibility
2. App-UI, global-sync, MCP, Session-Composer
3. Session prompt, attachment handling, tool registry
4. Bash background tools, webfetch/websearch proxy support
5. Desktop updater, packaging, reset flow, update server

## Feature-Map

### 1. Updater, Deployment, Reset, Beta Rollout

Implementierung:
- Neuer Update-Server mit Version/URL/Provider-Config/Beta-Status-Endpoints.
- Neue Admin-UI für Upload, Audit, Feedback und Modellstatus.
- Electron und Tauri lesen Update-Server-Metadaten und vergleichen lokale Version gegen Server-Version.
- Windows-Installer darf nur an einem erlaubten Installationspfad landen.
- Reset-Flow ist als PowerShell-Script in die Desktop-Apps eingebaut.
- Beta-Status steuert Menüeinträge und Feedback-Funktion.

Wichtige Dateien:
- [infra/opencode-updater/Program.cs](C:/Users/Klaus/Desktop/PFH/opencode/infra/opencode-updater/Program.cs)
- [infra/opencode-updater/admin-ui/src/app/app.component.ts](C:/Users/Klaus/Desktop/PFH/opencode/infra/opencode-updater/admin-ui/src/app/app.component.ts)
- [packages/desktop/src/update-server.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/desktop/src/update-server.ts)
- [packages/desktop-electron/src/main/update-server.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/desktop-electron/src/main/update-server.ts)
- [packages/desktop-electron/src/main/install-directory.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/desktop-electron/src/main/install-directory.ts)
- [packages/desktop-electron/src/main/ipc.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/desktop-electron/src/main/ipc.ts)
- [packages/desktop/src/index.tsx](C:/Users/Klaus/Desktop/PFH/opencode/packages/desktop/src/index.tsx)
- [packages/desktop-electron/src/main/index.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/desktop-electron/src/main/index.ts)

Implementierungsdetails:
- `updateServer.fetch()` lädt `version` und `url` separat und verwirft unvollständige Antworten.
- Tauri nutzt `updateServer.compareVersions(pkg.version, remote.version)` vor `check()`.
- Electron setzt `autoUpdater.autoInstallOnAppQuit = false` und `disableWebInstaller = true`.
- Windows-Signing ist nur aktiv, wenn passende KeyVault/Trusted-Signing-Env-Variablen vorhanden sind.
- Der Reset-Flow startet `reset-opencode.ps1` via PowerShell und ist sowohl in Tauri als auch Electron vorhanden.
- Das Desktop-Menü zeigt Beta-Status und einen Beta-Feedback-Eintrag.

### 2. Config, Managed Config, Provider, RRZ AI Factory

Implementierung:
- Neue Config-Felder für `http_proxy`, `aifactory_host`, `use_http_proxy`.
- Globale Config kann managed Proxy automatisch setzen oder entfernen.
- Legacy AI-Factory-Provider wird in den Auth-Store migriert.
- Remote Provider-Config vom Update-Server wird geladen und in die lokale Provider-Konfiguration gemerged.
- `mcp`-Objekte werden beim Speichern komplett ersetzt, damit entfernte Server wirklich aus der Datei verschwinden.
- AI Factory bekommt dynamische Model-Limits, Modality-Flags und Visibility-Overrides aus der Server-Config.
- Proxy wird pro Provider beachtet, inklusive `NO_PROXY`-Ergänzung für AI Factory.

Wichtige Dateien:
- [packages/opencode/src/config/config.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/config/config.ts)
- [packages/opencode/src/config/managed.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/config/managed.ts)
- [packages/opencode/src/provider/provider.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/provider/provider.ts)
- [packages/opencode/src/provider/models.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/provider/models.ts)
- [packages/opencode/src/provider/provider.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/provider/provider.ts)
- [packages/opencode/test/config/config.test.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/test/config/config.test.ts)
- [packages/opencode/test/config/managed-provider.test.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/test/config/managed-provider.test.ts)
- [packages/opencode/test/provider/provider.test.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/test/provider/provider.test.ts)

Implementierungsdetails:
- `managedHttpProxyPatch()` setzt `http_proxy` auf den Default, sofern `use_http_proxy !== false`.
- `providerConfigPayload()` akzeptiert sowohl nackte Provider-JSONs als auch `Updater.ProviderConfig` und `updater.providerConfig`.
- `providerConfigRequestInit()` sendet nur den AI-Factory-Key via Header `X-OpenCode-AiFactory-Api-Key`.
- `readProviderConfig()` nutzt `AbortSignal.timeout(3000)` und fällt bei Fehlern auf `{}` zurück.
- `discoverAiFactoryModels()` lädt Regeln und Modelle parallel und baut Model-Objekte mit den Server-Overrides.
- `resolveAiFactoryModelOverrides()` bestimmt Kontext, Output, Temperatur, Reasoning und Modalities per glob rule.
- `applyProviderProxyConfig()` ergänzt `NO_PROXY`/`no_proxy` um den AI-Factory-Host und setzt globale Proxy-Env-Variablen.

### 3. App Models, Visibility, Model Switch Compaction

Implementierung:
- Modell-Sichtbarkeit wird aus lokalen Default-Regeln plus Server-Regeln berechnet.
- AI Factory Modelle können serverseitig versteckt oder sichtbar gemacht werden.
- Beim Modellwechsel wird automatisch kompaktiert, wenn das letzte Assistant-Token-Volumen nahe an der Kontextgrenze liegt.
- Die UI bevorzugt sichtbare Modelle und den konfigurierten Provider.

Wichtige Dateien:
- [packages/app/src/context/model-selection.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/context/model-selection.ts)
- [packages/app/src/context/model-visibility.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/context/model-visibility.ts)
- [packages/app/src/context/model-switch-compaction.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/context/model-switch-compaction.ts)
- [packages/app/src/context/models.tsx](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/context/models.tsx)
- [packages/app/src/context/local.tsx](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/context/local.tsx)
- [packages/app/src/pages/session/compaction-visibility.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/pages/session/compaction-visibility.ts)
- [packages/app/src/components/session/session-context-usage.tsx](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/components/session/session-context-usage.tsx)
- [packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx)

Implementierungsdetails:
- `resolveConfiguredModelKey()` kann `provider/model` und nackte Modell-IDs lösen.
- `isModelVisibleBase()` verwendet Policy, manuelle Sichtbarkeit, Latest-Set und Release-Datum.
- `computeForcedVisibleModelKeys()` stellt sicher, dass konfigurierte und Default-Modelle sichtbar bleiben.
- `shouldCompactOnModelSwitch()` prüft die letzte Assistant-Message mit Token-Infos gegen Kontextlimit, 90%-Schwelle und Fallback-Schwelle.
- `local.model.set()` und die TUI-Pendants können Kompaktion per Option `compact: false` überspringen.

### 4. MCP Management, Global Sync, Session List

Implementierung:
- Neues MCP-Settings-UI mit lokalen und Remote-Servern, Headern und OAuth-Feldern.
- Managed MCP-Infos können per HTTP abgefragt werden.
- Global Sync dedupliziert und cached per stabilen Pfadschlüssel, nicht nur per Rohpfad.
- Session-Events werden nicht mehr zu früh getrimmt, sondern sauber in den Store integriert.
- Session-Listen können archivierte Sessions explizit filtern.

Wichtige Dateien:
- [packages/app/src/components/settings-mcp.tsx](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/components/settings-mcp.tsx)
- [packages/app/src/components/dialog-mcp-form.tsx](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/components/dialog-mcp-form.tsx)
- [packages/app/src/components/mcp-errors.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/components/mcp-errors.ts)
- [packages/app/src/components/mcp-ui-state.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/components/mcp-ui-state.ts)
- [packages/app/src/context/global-sync.tsx](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/context/global-sync.tsx)
- [packages/app/src/context/global-sync/child-store.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/context/global-sync/child-store.ts)
- [packages/app/src/context/global-sync/queue.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/context/global-sync/queue.ts)
- [packages/app/src/context/global-sync/event-reducer.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/context/global-sync/event-reducer.ts)
- [packages/opencode/src/server/routes/instance/mcp.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/server/routes/instance/mcp.ts)
- [packages/opencode/src/server/routes/instance/httpapi/mcp.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/server/routes/instance/httpapi/mcp.ts)

Implementierungsdetails:
- `DialogMcpForm` verwaltet `local` und `remote` Typen separat, inkl. Validierung und Header-Liste.
- Beim Speichern wird der globale MCP-Block aktualisiert und im Child-Store der Status vorbereitet.
- `createRefreshQueue()` verwendet `Map<key, directory>` statt `Set<string>`.
- `directoryKey()` stammt aus `packages/app/src/utils/path-key.ts` und wird an mehreren Stellen genutzt.
- MCP-Managed-Routen liefern serverseitig `mcp.managed`, wenn das Backend es anbietet.

### 5. Session UX, Followups, Todos, Permissions

Implementierung:
- Followup-Dock kann jetzt löschen, verschieben und separat "steuern".
- Todo-Dock zeigt einen resumable/continue-State und unterscheidet `live`, `resumable`, `done`, `hold`.
- Permission-Dock bietet einen `full-access`-Pfad, der Auto-Accept für das Verzeichnis aktiviert.
- Session-Delete wurde als Kontextmenü + Bestätigungsdialog umgesetzt.
- Session-Working-Checks sind ausgelagert und werden von Sidebar, Session-Page und Kontextmetriken genutzt.

Wichtige Dateien:
- [packages/app/src/pages/session/composer/session-followup-dock.tsx](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/pages/session/composer/session-followup-dock.tsx)
- [packages/app/src/pages/session/composer/session-todo-dock.tsx](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/pages/session/composer/session-todo-dock.tsx)
- [packages/app/src/pages/session/composer/session-permission-dock.tsx](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/pages/session/composer/session-permission-dock.tsx)
- [packages/app/src/pages/session/composer/session-composer-state.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/pages/session/composer/session-composer-state.ts)
- [packages/app/src/pages/layout/sidebar-items.tsx](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/pages/layout/sidebar-items.tsx)
- [packages/app/src/utils/session-working.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/app/src/utils/session-working.ts)

Implementierungsdetails:
- `todoState()` kennt jetzt zusätzlich `hold`.
- `resumable` ist true, wenn Todos offen sind, die Session aber weder done noch live ist.
- `decide("full-access")` ruft `permission.enableAutoAcceptDirectory()` auf und beantwortet die aktuelle Permission indirekt mit `once`.
- `SessionFollowupDock` bekommt `onSteer`, `onDelete` und `onMove`.
- `SessionItem` zeigt Kontextmenü-Delete und hält Archive-Action weiterhin direkt sichtbar.

### 6. Prompt, Attachments, Tool-Runtime

Implementierung:
- Nicht-lesbare Anhänge werden in ein Temp-Verzeichnis kopiert und mit Tool-Hinweisen versehen.
- File-Paste fügt für normale Dateien eine File-Referenz mit `file://`-URL ein.
- Tool-Schemas fallen auf ein permissives Schema zurück, wenn JSON-Schema-Erzeugung scheitert.
- Session-Titel haben einen Text-Fallback aus der ersten User-Nachricht.

Wichtige Dateien:
- [packages/opencode/src/session/prompt.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/session/prompt.ts)
- [packages/opencode/src/session/message-v2.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/session/message-v2.ts)
- [packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx)
- [packages/opencode/src/tool/registry.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/tool/registry.ts)

Implementierungsdetails:
- `sanitizeHTML()` entfernt Scripts, Styles, Cookie/Consent-Overlays und Dialoge.
- `formatFetchedContent()` liefert hilfreiche Fehlermeldungen bei leerer Ausgabe.
- `fallbackTitle()` kürzt Text auf 8 Wörter bzw. 50 Zeichen.
- `OutputFormatJsonSchema.retryCount` ist optional statt mit Default belegt.

### 7. Bash Background, Webfetch, Websearch, Playwright

Implementierung:
- Bash kann lange Jobs im Hintergrund starten und später lesen oder stoppen.
- Webfetch folgt Redirects, unterstützt Proxy-Fälle unter Windows per PowerShell-Fallback und liefert bessere Text-Fallbacks.
- Websearch übernimmt Proxy-Konfiguration aus der App-Config.
- Playwright ist als neuer Tool-Entry im Registry-Set vorhanden.

Wichtige Dateien:
- [packages/opencode/src/tool/bash-process.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/tool/bash-process.ts)
- [packages/opencode/src/tool/bash.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/tool/bash.ts)
- [packages/opencode/src/tool/bash_read.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/tool/bash_read.ts)
- [packages/opencode/src/tool/bash_stop.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/tool/bash_stop.ts)
- [packages/opencode/src/tool/webfetch.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/tool/webfetch.ts)
- [packages/opencode/src/tool/websearch.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/tool/websearch.ts)
- [packages/opencode/src/tool/playwright.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/tool/playwright.ts)
- [packages/opencode/src/tool/registry.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/tool/registry.ts)

Implementierungsdetails:
- `bash` unterstützt `run_in_background`.
- `BashProcess.start()` schreibt stdout/stderr in Logdateien unter einem Truncation-Verzeichnis.
- `bash_read` liest per `process_id`, `stream`, `offset` und `limit`.
- `webfetch` nutzt unter Windows `powershell.exe` + `Invoke-WebRequest` wenn Proxy aktiv ist.
- `websearch` übergibt optional den konfigurierten Proxy an das MCP-Exa-Layer.
- `ripgrep` nimmt bevorzugt `OPENCODE_RIPGREP_PATH`.

### 8. Desktop electron-spezifische Infrastruktur

Implementierung:
- Shell-Env-Probe läuft jetzt asynchron statt blockierend.
- Native watcher fallbackt sauber auf `chokidar`.
- Electron-Renderer interceptet Download-/Tool-Links und bietet Öffnen/Speichern an.
- Boot- und Updater-Pfade wurden auf stabilere Fetch-/IPC-Schemata umgestellt.

Wichtige Dateien:
- [packages/desktop-electron/src/main/shell-env.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/desktop-electron/src/main/shell-env.ts)
- [packages/desktop-electron/src/main/server.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/desktop-electron/src/main/server.ts)
- [packages/desktop-electron/src/main/logging.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/desktop-electron/src/main/logging.ts)
- [packages/desktop-electron/src/main/ipc.ts](C:/Users/Klaus/Desktop/PFH/opencode/packages/desktop-electron/src/main/ipc.ts)
- [packages/desktop-electron/src/renderer/index.tsx](C:/Users/Klaus/Desktop/PFH/opencode/packages/desktop-electron/src/renderer/index.tsx)

Implementierungsdetails:
- `prepareServerEnv()` setzt `OPENCODE_RIPGREP_PATH` wenn ein gebündeltes Binary vorhanden ist.
- `loadShellEnv()` nutzt `spawn` mit Timeout statt `spawnSync`.
- `tail()` in `logging.ts` ist async.
- `fetch-update-server` im IPC hängt den AI-Factory-Key als Header an.

## Wieder-Einbau-Checkliste
- Config und managed config zuerst.
- Dann Provider- und Model-Visibility-Logik.
- Danach UI: MCP, Settings, Session-Composer, Sidebar, Dialoge.
- Anschließend Prompt- und Tooling-Änderungen.
- Zum Schluss Desktop-Release, Updater, Packaging und Reset-Flow.

## Tests Und Validierung
- `packages/opencode`: `bun typecheck`
- `packages/opencode`: relevante Unit-Tests für config, provider, session prompt, tools
- `packages/app`: Sichtbarkeit, Sync, Model Switch Compaction
- `packages/desktop-electron`: Build-/Packaging-Pfade auf Windows prüfen
- `packages/desktop`: Tauri-Build und Update-URL-Injektion prüfen

