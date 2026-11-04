# Projektplan und Einstieg für parallele Sessions

Stand: **04.11.2026**, Quellbasis **`e40b5d41c1`**, Branch **`feat/merge-upstream-v2.1.2`**.
Dieses Dokument fasst den Corporate-Fork zusammen. Für eine Aufgabe zuerst die passende Zeile im Wegweiser lesen und nur die betroffenen Quellen prüfen. Quellcode, aktuelle Git-Diffs und paketbezogene `AGENTS.md` bleiben maßgeblich. Historische Testergebnisse sind keine Zusage für spätere Änderungen.

## 1. Arbeitsort zuerst klären

| Ort | Bedeutung |
| --- | --- |
| `C:/Users/Klaus/.codex/worktrees/merge-upstream/opencode` | Arbeitsstand dieser Session; hier liegen dieser Plan und die aktuellen Corporate-Fixes. |
| `C:/Users/Klaus/Desktop/PFH/opencode` | Anderer Checkout: `feat/merge-upstream-dev-v18`, mit uncommitteten Änderungen anderer Arbeit. Nicht mit unserem Stand gleichsetzen oder dessen Änderungen pauschal übernehmen. |
| `C:/Users/Klaus/.codex/worktrees/bf02/opencode` | Separater Worktree; dessen Updater-Compose und Konfigurations-Bind-Mounts wurden für die lokale Docker-Umgebung verwendet. |

Vor Änderungen reichen zunächst `git branch --show-current`, `git status --short` und `git log -3 --oneline`. Keine fremden Änderungen zurücksetzen, bereinigen oder mitcommitten. Bei anderem Checkout diesen Plan über seinen absoluten Pfad lesen, statt Änderungen unbemerkt im falschen Branch fortzuführen.

**Release-Grenze:** `v2.2.2-ai.1` zeigt auf `aabe2d1ed4`. Der anschließend gepushte, vom Nutzer im Firmennetz bestätigte MCP-/ChatGPT-Login-Fix ist `c5ccfc30d4`; der folgende Inferenz-Fix ist `e40b5d41c1`. Beide sind **nicht in diesem Tag**. Veröffentlichte Tags unverändert lassen. Die Paketversion ist weiterhin `2.2.2`; ein Git-Tag allein erhöht weder Installer-Version noch Update-Angebot.

## 2. Architektur und gezielter Wegweiser

Abhängigkeiten: Schema → Core/Protocol → Server. Client-Laufzeit darf Schema und Protocol nutzen, nicht Core oder Server. Desktop hostet Electron und GUI-Plugins; die CLI bzw. der Hintergrunddienst führt Core/Server aus.

| Aufgabe | Zuerst lesen |
| --- | --- |
| Electron-Start, Fenster, IPC, CLI-Dienst | `packages/desktop/src/main/desktop.ts`, Unterordner `lifecycle/`, `service/`, `ipc-handlers/` |
| Desktop-Updater, Kanal-Key, Changelog, Fortschritt | **`packages/gui-plugins/src/updater/`**, insbesondere `main.ts`, `corporate.ts`, `platform.ts`, `download.ts`, `client.ts` – nicht nur unter Desktop suchen |
| Windows-Paketierung und Signierung | `packages/desktop/electron-builder.config.ts`, `packages/desktop/script/`, `script/package-desktop-electron-win.ps1`, `script/sign-windows.ps1` |
| Installationspfad, optionale CLI-Registrierung | `packages/desktop/resources/windows/installer.nsh`, `packages/desktop/script/corporate-installer.test.ts` |
| Updater-Backend und Rollout | `infra/opencode-updater/Program.cs`, `infra/opencode-updater/README.md` |
| Admin-Weboberfläche | `infra/opencode-updater/admin-ui/src/app/`; MCP-, MCP-Store-, Plugin-Store- und Modellstatus-Panels getrennt betrachten |
| Managed Config und Kanalwahl für Modelle | `packages/core/src/config/managed.ts`, `packages/core/src/config.ts`, `packages/core/src/plugin/provider/aifactory.ts` |
| Modellauswahl und Einstellungen | `packages/app/src/providers/models/`, `packages/app/src/settings/`; Anbieter-/Sichtbarkeitsregeln auch auf Core-Seite prüfen |
| MCP-Konfiguration und Dialoge | `packages/schema/src/mcp.ts`, `packages/app/src/settings/mcp/dialogs.tsx`, `model.ts` |
| MCP-Laufzeit, OAuth und Header | `packages/core/src/mcp/client.ts`, `oauth.ts`, `headers.ts` |
| Proxy-Auswahl und Windows-Authentifizierung | `packages/util/src/http-proxy.ts`, `http-proxy-windows.ts` |
| ChatGPT/Codex-Anmeldung | `packages/core/src/plugin/provider/openai.ts`, `chatgpt.ts` |
| Dokumente, PDF, Office, Vision | `packages/core/src/tool/plugin/document.ts`, `packages/core/src/document/{cache,extract,pdf}.ts` |
| Registrierung eingebauter Tools | `packages/core/src/plugin/internal.ts`; hier dürfen DocumentTools bei Merges nicht verschwinden |
| Datei-Encoding erhalten | `packages/core/src/file-mutation.ts`, `packages/util/src/bom.ts` |
| Websuche/Webfetch | `packages/core/src/websearch.ts`, `packages/core/src/config/plugin/websearch.ts`, `packages/core/src/tool/plugin/webfetch.ts` |
| Session-/Timeline-Oberfläche | `packages/app/src/session/`, `packages/session-ui/src/`; vor Änderungen dort Benchmark-Regeln beachten |
| Plugin-Laufzeit / Store | `packages/plugin/src/{effect,promise}/`, `packages/core/src/plugin/`, `packages/core/src/config/managed-plugin.ts`, Extensions-Einstellungen und Admin-UI |
| V2-Session-Verträge | `specs/v2/session.md`, `specs/v2/tools.md`, Root-`AGENTS.md`; `specs/v2/` ist kein Aufgaben-Backlog |

`packages/core/src/v1/` enthält zusätzliche Legacy-/Migrationspfade. Eine Änderung dort allein beweist keine Wirkung im aktuellen V2-Pfad.

## 3. Bestätigte Entscheidungen und Verhalten

### MCP und Firmenproxy

- Remote-MCPs verwenden `use_http_proxy: false` als Standard. Nur `true` aktiviert den konfigurierten Proxy für Transport und backendseitige OAuth-Anfragen.
- Der Schalter existiert im App-Dialog sowie in den Admin-Formularen für verwaltete MCPs und MCP-Store-Einträge. Store-Installation übernimmt ihn.
- `http-proxy.ts` erhält direkte interne Routen für `10.53.7.23`, `ai.proxy01.ksq.at` sowie lokale Dienste. AI Factory darf dafür nicht von einer manuell gesetzten `NO_PROXY`-Variablen abhängen.
- Die Konfigurationsfelder `use_http_proxy` und `aifactory_host` bleiben unterstützt.
- Leerer MCP-Header `x-litellm-api-key` kann den AI-Factory-Key verwenden; zuständig ist `mcp/headers.ts`. Schlüssel nie in Logs, Kommandozeilen oder Diagnosedokumente schreiben.
- Der zuerst eingeführte Windows-Fallback mit dynamischem PowerShell/.NET-Code scheiterte im Firmennetz: Die äußere Testdatei lief als FullLanguage, gestartete Befehle dagegen als ConstrainedLanguage. Bestätigter Fehler: `MethodInvocationNotSupportedInConstrainedLanguage`.
- **Aktueller Fix `c5ccfc30d4`: Windows-System-`curl.exe` statt PowerShell.** Proxy-Authentifizierung nutzt den nativen Transport; Konfiguration und Daten gehen über stdin/Named Pipes, ohne Klartext-Geheimnisse in Prozessargumenten oder temporären Dateien. TLS-Prüfung bleibt aktiv. Keine Abschaltung von Firmenrichtlinien.
- Nutzer hat danach **MCP und ChatGPT-Login erfolgreich bestätigt**. Diese Bestätigung ersetzt kein neues Testen nach späteren Änderungen.
- **Nachtrag 04.11.: Login erfolgreich bedeutet noch nicht Inferenz erfolgreich.** Der Nutzer meldet HTTP-Proxy-407 bei der eigentlichen OpenAI-Modellanfrage. Ursache im Quellcode: `packages/util/src/effect/app-node-platform.ts` verwendete für den gemeinsamen HTTP-Client noch `HttpProxy.fetch`, während OAuth/MCP bereits `fetchAuthenticated` nutzten. Fix **`e40b5d41c1`** stellt die gemeinsame Standardschicht auf `fetchAuthenticated` um; explizite Fetch-Injektionen und interne Bypässe bleiben erhalten. Der Regressionstest `packages/core/test/effect/model-proxy.test.ts` reproduzierte den Fehler vor dem Fix über den echten Core-Modellexecutor. Nach dem Fix bleiben zstd-Body, OpenAI-Authorization und Account-Header beim Proxy-Retry erhalten und SSE kommt vor Abschluss der Antwort an. Vier neue Fälle liefen zehnmal grün, einschließlich internem Gateway und nicht erneut gesendeten 401/403-Anbieterfehlern. Firmen-PC-Test mit neuem Build steht noch aus.

### Updater und API-Key zur Beta-/AI-Gilde-Erkennung

**Am 04.11.2026 im aktuellen 2.2.2-Quellstand geprüft: Ja, der Key wird mitgeschickt.**

1. `updater/main.ts` liest über den aktuellen Sidecar `credential.list()` und wählt den aktiven Eintrag mit `integrationID === "aifactory"` und `value.type === "key"`.
2. Falls dort kein Schlüssel vorliegt: Fallback auf `OPENCODE_AIFACTORY_API_KEY`.
3. `corporate.ts` setzt `X-OpenCode-AiFactory-Api-Key` für `/opencode/version` und `/opencode/url`; auch die Changelog-Abfrage bekommt diesen Header.
4. `platform.ts` setzt ihn zusätzlich in `electron-updater.requestHeaders` für Feed/Manifest und Downloads. Der lokale Sidecar-Basic-Auth-Header wird dabei nicht zum Updater weitergereicht.
5. Backend: `UpdaterRolloutResolver.ResolveAsync` liest den konfigurierten Header, standardmäßig denselben Namen, und löst den Key über LiteLLM `KeyInfoPath` auf. Bei mehreren Treffern gilt **Beta vor AI Gilde vor Normal**. Das Feed kann zusätzlich ein vom Server abgeleitetes Kanal-Token als `?beta=...` führen; das ist nicht der rohe API-Key.

**Grenzen:** Beim initialen Lookup ohne Key, bei deaktivierten/fehlenden Testerregeln oder fehlgeschlagenem LiteLLM-Lookup fällt der Server auf Normal zurück. Ein noch gültiges, vom Server erzeugtes Kanal-Token kann spätere Feed-Anfragen ebenfalls zuordnen. Der Desktop-Updater liest nicht selbst zusätzlich `provider(s).aifactory.options/settings.apiKey`; der Managed-Config-Code hat einen eigenen, weiter gefassten Resolver. Falls ausschließlich ein statischer JSON-Key verwendet wird, die resultierende Credential-Liste und beide Resolver gezielt prüfen, statt ihre Gleichheit anzunehmen.

Authentifizierte Versions-/Feed-Abfrage ist durch `corporate.test.ts` abgedeckt. `client.test.ts` enthält einen echten isolierten Electron-Test, der den Header auf Manifest und Installer prüft. Backend-Konfiguration und LiteLLM-Berechtigungen müssen zur Installation passen. Der bekannte Fall „LiteLLM-Key sieht Modelle nur über Access-Gruppe“ war laut Nutzer eine LiteLLM-Berechtigungs-/API-Problematik.

### Release- und Konfigurationsstufen

- Drei Stufen: **Beta → AI Gilde → Normal**. Release-Promotion erfolgt manuell ohne positives Feedback als Voraussetzung.
- Modellkonfiguration ist ebenfalls dreistufig. Pro Modell übernimmt ein Button die Einstellungen der Vorstufe einmalig; kein dauerhafter automatischer Sync.
- Normal/Beta verwenden die vorhandenen Appsettings-Dateien. AI Gilde kann eine eigene Datei verwenden, sonst liegt sie im persistenten Datenverzeichnis. Bestehende Mounts nicht blind ersetzen.
- Delivery-Stopp liefert bei Metadaten ein „kein Update“-Ergebnis bzw. passende Client-Version. Installer-Downloads bleiben blockiert. Bei Electron `allowDowngrade` keine künstliche niedrigere Version anbieten.
- Changelog wird vom konfigurierten Updater geladen. Der Paketierungs-Wrapper kopiert das Root-Changelog in den Output.
- Feedback-Schreibendpunkte wurden absichtlich deaktiviert/deprecated. Nicht versehentlich Feedback-Gates wieder einführen.

### Modelle, Dokumente und Plugins

- Corporate-Vorgabe: AI Factory, OpenAI und GitHub Copilot; AI Factory zuerst. Ausgeblendete Modelle gehören nicht in die Chat-Auswahl, konfigurierte Hintergrund-Worker müssen trotzdem auflösbar bleiben.
- Modellregeln kommen aus `provider-config.json`: Sichtbarkeit, Limits, Reasoning-Stufen sowie PDF-/Bild-/OCR-/Vision-Fähigkeiten und Worker-Modelle gehören zusammen.
- PDF-Text und Seitenbilder werden lokal mit PDF.js verarbeitet; Seitenrendering benötigt `@napi-rs/canvas`. Office-Extraktion verwendet lokal `@firecrawl/anydoc-wasm`. Nicht mit einem gehosteten AnyDoc-/OCR-Upload gleichsetzen.
- Native PDF-/Bildeingabe und Worker-Auswahl werden durch die Modellpolicy entschieden. Übermittlung an ein konfiguriertes Modell ist von der lokalen Extraktion zu unterscheiden.
- `document_summary` verarbeitet längere Quellen in Teilen und verwendet die Modellkonfiguration für die Generierung. Zahlen wie `8192` in anderen OCR-/Vision-Aufrufen nicht pauschal als Summary-Grenze interpretieren.
- `vision_recall` muss auch bei textbasierten Chatmodellen über den hinterlegten, gegebenenfalls ausgeblendeten Vision-Worker funktionieren.
- Office-Erstellung/-Bearbeitung bleibt Aufgabe der verfügbaren MCP-Tools; Text-Extraktion ist kein Nachweis für native Office-Bearbeitung.
- Plugin Store ist implementiert: Admin verwaltet optionale npm-Pakete, App installiert sie unter Extensions → Plugins. Persistenz über `UpdaterPluginStore` in der vorhandenen SQLite-Datenbank. Nicht mit dem MCP-Katalog zusammenwerfen.
- `rem-memory@2.0.1` wurde als Paketbeispiel besprochen. Tests eines Ports im älteren Checkout sind kein Kompatibilitätsbeweis für unseren Branch oder einen künftigen 2.2.5-Merge.

### Hilfsagenten und Compaction zentral konfigurieren: Prüfung vom 04.11.

- Lokal unterstützt 2.2.2 bereits `agents.title.model`, `agents.compaction.model`, `compaction.auto`, `compaction.keep.tokens` und einen numerischen `compaction.buffer`. `auto: true` und `keep.tokens: 15000` sind bereits die Core-Standardwerte.
- **`buffer: "30%"` ist im aktuellen 2.2.2-Schema nicht gültig.** Der verglichene Upstream-v2.2.5-Stand unterstützt Prozentwerte; dafür ist ein neuer Client bzw. ein gezielter Backport nötig.
- Unser Provider-Präfix ist `aifactory/`, nicht das im Vorschlag genannte `rrz/`; Modell-ID zusätzlich gegen den tatsächlichen Katalog prüfen.
- `config.ts` übernimmt die zentrale Provider-Konfiguration bereits als Config-Dokument vor den lokalen Einträgen. Der Client braucht daher für bereits unterstützte Agent-/Compaction-Felder keinen neuen generellen Merge-Mechanismus; lokale Einstellungen können Vorgaben überschreiben.
- Backend-`ProviderConfigOptions` liefert bisher nur `model`, `small_model`, `aifactory` und `mcp`. Für zentrale Agent-/Compaction-Felder müssen Backend-Datentypen/Persistenz sowie Admin-UI erweitert werden. `small_model` lässt sich schon zentral setzen und wird in `config/normalize.ts` auf den Title-Agenten abgebildet, nicht auf den Compaction-Agenten.
- Die Nutzerfrage war eine Prüfung der Machbarkeit. Noch keine persönlichen `opencode.json`-Dateien oder globalen Agent-/Compaction-Vorgaben geändert und nichts ausgerollt.

## 4. Priorisierte nächste Arbeit

| Priorität | Arbeit | Fertig, wenn |
| --- | --- | --- |
| P0 | Nächsten Corporate-Release einschließlich `e40b5d41c1` vorbereiten | Neue Release-Version/Tag bewusst gewählt; echte ChatGPT-Modellanfrage, Key-Zuordnung für Beta/AI Gilde/Normal und Installer auf Firmen-PC geprüft. Vorhandenen Tag nicht verschieben. Bei automatischem Update muss die neue App-Version größer als die installierte `2.2.2` sein. |
| P1 | Updater-Identität gezielt prüfen, falls jemand falschen Kanal erhält | Aktiver AI-Factory-Key/Env vorhanden, erwarteter Header kommt an, `beta.Enabled`/Testerregeln/LiteLLM-Lookup stimmen; keine echten Schlüssel protokolliert. Ggf. JSON-only-Key-Fall gesondert unterstützen. |
| P1 | Corporate-Regressionen vor Upstream-Merge dokumentieren | Providerfilter, versteckte Worker, Dokumente, Encoding, Proxy, Installer und Updatepfad haben gezielte aktuelle Nachweise; nicht nur „Merge konfliktfrei“. |
| P2 | Upstream bis v2.2.5 integrieren | Konflikte manuell gelöst, Corporate-Verhalten erhalten, passende Paket-/UI-Tests und Typprüfungen grün; separater Release nach der gesicherten Basis. |
| P2 | Plugin-/rem-memory-Kompatibilität des Zielstands | Reales npm-Paket im tatsächlich gemergten Branch geprüft; Session-, Event-, Tool- und neue Artifact-Hooks korrekt. |
| P2 | Dokument-Problemfälle nachtesten | Gemeldete große PPTX, XLSX-Summary und konfigurierte Vision-Worker funktionieren mit aktuellem Build; keine unbeabsichtigten externen Uploads. |
| P2 | Zentrale Hilfsagenten-/Compaction-Vorgaben planen | Backend/Admin-UI unterstützen die gewünschten Felder; Prozentpuffer erst an Clients mit passendem Schema ausliefern. Drei Stufen und lokale Überschreibungen erhalten. |
| Bei Bedarf | Legacy-Tauri-Updates, Installer-CLI-Registrierung, SQLite-Abhängigkeiten | Jeweils eigener Nachweis. Authenticode oder SHA512 sind keine Tauri-Updater-Signatur. CLI-Registrierung nicht ohne Prüfung wieder aktivieren; alten NU1903-Status bei Dependency-Arbeit neu prüfen. |

### Bekannte Vorprüfung zu v2.2.5

- Offizielle Vergleichsrefs: `anomalyco/review-v2.2.2` = `098aa7fd6e`; `anomalyco/review-v2.2.5` = `9bbb8ce18c`.
- **Noch kein echter Merge vorgenommen.** Die damalige `git merge-tree`-Vorprüfung auf `ada84c5b90` ergab sieben Konfliktdateien: `bun.lock`; `packages/app/src/runtime/server/global-sync/utils.ts` und dessen Test; `packages/app/src/session/timeline/interaction.ts`; `packages/core/src/plugin/internal.ts`; `packages/core/test/tool-opencode.test.ts`; `packages/desktop/electron-builder.config.ts`.
- Bei `plugin/internal.ts` müssen unsere **DocumentTools und die neuen ArtifactTools beide erhalten bleiben**. Kein pauschales „theirs“ auf Corporate-Dateien.
- Relevanter Nutzen: LiteLLM-Kontextfehler/Compaction, große MCP-stdio-Nachrichten, Reasoning-Fortsetzungen, schnellere lange Chats, persistente Terminals und experimentelle Artifacts.
- Vorprüfung ist historisch: vor tatsächlichem Merge auf aktuellem HEAD wiederholen. Details lokal unter `artifacts/upstream-v2.1.2-review/v225-independent-review.md`; dieser ignorierte Ordner ist keine Voraussetzung für das Verständnis dieses Plans.

## 5. Build, Betrieb und Tests

- Kein vollständiger Desktop-/CLI-Build, Installerlauf oder Neustart der Nutzer-App ohne konkrete Anweisung. Tests verwenden isolierte Fixtures. Keine Änderungen an Live-Konfiguration, Auth-Daten, PATH oder installierter App als Nebenwirkung.
- Corporate-Binaries, Sidecar und Update-Staging müssen unter `C:/Entwicklung` bleiben; Installationsziel `C:/Entwicklung/OpenCode`. Temporär deaktivierte CLI-Registrierung wird über `OPENCODE_REGISTER_CLI` gesteuert, standardmäßig aus.
- Der Windows-Build benötigt die Corporate-`electron-builder.config.ts`. `OPENCODE_ELECTRON_OUTPUT_DIR` muss eingehalten werden; alte `dist-*` dürfen nicht im ASAR landen. Frühere Fehlkonfiguration erzeugte ein übergroßes ASAR und falsche Namen/Pfade.
- Bun für diesen Branch: **1.4.4**. Auf diesem PC liegt es unter `C:/Users/Klaus/AppData/Local/npm-cache/_npx/9ec17c29a94a501f/node_modules/bun/bin/bun.exe`; vor Verwendung Existenz/Version prüfen. Das globale Bun 1.3.14 gehörte zu älterer Arbeit.
- Tests aus Paketverzeichnissen, nie Root. Core: `bun run script/test.ts <dateien>`; Typprüfung: `bun typecheck` im betroffenen Paket. Vollständiger Check: Root `bun run check`. Repository-Skills vor neuen/geänderten Tests beachten.
- Bei öffentlicher Protocol-/Server-HttpApi-Änderung `bun run generate` in `packages/client`; generierte Dateien nicht von Hand ändern. Legacy-SDK separat über `packages/sdk/js/script/build.ts`.
- Für Quelldatei-Änderungen auf diesem Windows-Setup `apply_patch` oder echtes Node-`fs.writeFileSync(..., {flag: "w"})` verwenden. Bun-basierte Schreib-/Formatierpfade haben zuvor alte Dateireste stehen lassen. Während laufender nativer Typprüfung keine TS-Dateien verändern.
- GUI-Dateien benötigen `bun run lint:changed HEAD` ohne Diagnosen; Core/Util zusätzlich gezielt mit oxlint prüfen. Windows-`oxlint --fix` verursachte zuvor einen Mapped-File-Panikfehler.

### Kurze, passende Prüfungen

| Änderung | Bestehende Prüfungen |
| --- | --- |
| Windows-/MCP-/OAuth-/Modell-Proxy | Util `test/http-proxy.test.ts`, `test/http-proxy-windows.test.ts`; Core `test/mcp-oauth.test.ts`, `test/plugin/provider-oauth-proxy.test.ts`, `test/effect/model-proxy.test.ts`, `test/network-guard.test.ts` |
| Updater-Key/Version/Changelog | GUI-Plugins `src/updater/corporate.test.ts`; nativer Download zusätzlich `src/updater/client.test.ts` mit isoliertem Electron |
| Dokumente/Modelle | Betroffene Tests unter Core `test/` und App-Regressionsprüfungen gezielt auswählen; nicht aus einem anderen Checkout übernehmen |
| Installer/Paketierung | Desktop `script/corporate-installer.test.ts`, `script/windows-installer.test.ts`, vorhandene Paketierungsprüfungen |

Am Windows-Transport-Fix `c5ccfc30d4`: 16 Fälle zehnmal grün, weitere Proxy-/MCP-/TLS-Suites und 35 vollständige Typecheck-Tasks erfolgreich; Nutzer bestätigt MCP und ChatGPT-Login. Am 04.11. zusätzlich `src/updater/corporate.test.ts`: **25 Tests, 46 Assertions, grün**. Zum Inferenz-Fix: 28 Util-Proxyfälle, 32 Core-MCP-/Provider-OAuth-Fälle und 9 Modell-/Netzwerk-/Websearch-Fälle grün; die vier neuen Modellfälle außerdem zehnmal grün. Core-/Util-Typprüfungen und gezieltes oxlint ohne Fehler. Heute kein vollständiger Desktop-Build oder Firmen-Rollout ausgeführt.

### Docker: Backend und Admin-UI sind getrennte Artefakte

Lokales Compose-Projekt zuletzt `opencode-updater`, Dienste `opencode-updater` (Port 80 → 8080) und `opencode-updater-admin-ui` (Port 8081 → 80). Grund-Compose stammt aus `bf02/infra/opencode-updater/docker-compose.yml`; für Builds aus unserem Worktree wurde ein lokales Override `artifacts/upstream-v2.1.2-review/updater-current-source.compose.json` verwendet. Vor Docker-Arbeit aktuelle Contexts/Mounts/Images prüfen; diese Angaben sind kein Live-Inventar.

Backend-Neubau aktualisiert weder die ausgelieferte Admin-Weboberfläche noch den Desktop. Volumes, `/app/data/feedback.db`, Release-Dateien und Appsettings-Mounts erhalten. Andere Compose-Projekte nicht stoppen. Frühere automatische Ablehnung eines Backend-Neustarts wurde nicht umgangen; aktuelle Aktionen brauchen ihre eigene Autorisierung aus dem Auftrag.

## 6. Zusammenarbeit und Pflege

1. Pro Session Arbeitsbereich, Branch und Ausgangscommit notieren. Bei Überschneidung von Dateien zuerst koordinieren; fremde uncommittete Änderungen erhalten.
2. Vor großem Scan den Wegweiser nutzen. Nur Aussagen neu prüfen, die die aktuelle Aufgabe oder ein neuer Diff betreffen.
3. Nach Abschluss hier Status, Commit, Tests und offene Einschränkungen kurz aktualisieren. Bestätigte Implementierung, erzeugtes Build-Artefakt, Deployment und Nutzerbestätigung getrennt benennen.
4. Keine Keys, Tokens, persönlichen Appsettings oder Rohlogs in Plan/Commits ablegen. Diagnosebeispiele verwenden ausschließlich Testwerte.

Aktuelle Übergabe: MCP-/ChatGPT-Login-Fix ist vom Nutzer bestätigt; separater Inferenz-Fix `e40b5d41c1` ist implementiert und lokal geprüft, die echte Modellanfrage im Firmennetz steht noch aus. Upstream 2.2.5 bleibt geplant; API-Key-Weitergabe ist am 04.11. im Quellstand geprüft. Diese Session hat keinen Upstream-Merge und keinen neuen Build begonnen.
