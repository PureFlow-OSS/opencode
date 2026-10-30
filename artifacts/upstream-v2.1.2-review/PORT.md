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

Beim ersten Desktop-Start konnte ein wiederhergestellter Sitzungstab vor Abschluss
der asynchronen V1-Migration ein 404 erhalten. Die Fehleransicht blieb anschließend
bestehen, obwohl der Server die Sitzung nach der Migration wieder erfolgreich lieferte.
Der Renderer wartet jetzt vor Freigabe des Sidecars und Aufbau der Tabs auf den
abgeschlossenen Migrationsstatus. Fehler und Abbruch werden weitergereicht.
Acht Tests für Initialisierung und Migrationsablauf sowie der vollständige Check
bestehen. Ein separater unsignierter NSIS-Build unter
`packages/desktop/dist-v2.1.2-migration-fix` wurde erstellt; seine SHA-512-Metadaten
und die Übereinstimmung der paketierten Main-Chunks wurden geprüft. Die laufende
App und der Server wurden dabei nicht neu gestartet.

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

### Native MCP-Ansicht und Korrekturen am 21. Oktober

MCP-Verwaltung und Store sind jetzt gemeinsam unter Erweiterungen → MCPs eingebunden.
Die separate Navigation entfällt; alte MCP-URLs verweisen auf den nativen Untertab.
Vorhandene Server, Hinzufügen, Bearbeiten, Löschen und die nativen Schalter bleiben verfügbar.

Ausstehende Katalogabfragen werden vor jedem Query-Datenzugriff abgefangen, damit die
Seite während des Ladens sichtbar bleibt. Der Hinzufügen-Dialog verwendet wieder die
frühere Größe `x-large`, mit Innenabständen, scrollbarem Formular und festem Aktionsbereich.
Der Scrollbereich liegt im Formular, da die Dialog-Basiskomponente ihren Body abschneidet.

Der lokale Docker-Store lieferte zwei gültige Einträge. Die laufende CLI verwendete jedoch
noch ihre eingebettete ältere Update-URL. Der Desktop übergibt seine eingebettete URL nun
beim Start eines neuen CLI-Dienstes als Umgebung; eine explizite Laufzeitvariable hat Vorrang.
Ein bereits kompatibel laufender Dienst wird weiterhin übernommen und nicht neu gestartet.

Verifiziert: App- und Desktop-Typecheck, Lint ohne Fehler, 29 gezielte App-Tests,
drei Desktop-Umgebungstests und drei Browser-Komponententests. Diese prüfen verzögertes
Katalogladen, Umschalten, Hinzufügen, Store-Installation, Dialoggröße/Abstände/Scrollen
sowie den Erhalt erweiterter lokaler und Remote-Konfiguration beim Bearbeiten.

Auf ausdrücklichen Wunsch wurden für diese letzten Korrekturen kein vollständiger Build
und keine Paketierung ausgeführt. Die zuvor erstellten Installer enthalten diese
abschließenden Korrekturen deshalb noch nicht.

### Updater: lokale Serveradresse und veröffentlichte Feed-Adresse

Der gemeldete Fehler ließ sich mit dem lokalen Docker-Server reproduzieren:
`http://localhost/opencode/url` antwortete mit der produktiven Firmenadresse und
dem Pfad `/opencode/feed`. Die bisherige Origin-Prüfung lehnte diese Antwort ab.
Das Backend bildet die Adresse aus `Updater.PublicBaseUrl`; bei Beta bleibt der
Pfad gleich und erhält den Query-Parameter `beta`.

Der Server meldete bei der Diagnose Version `1.14.35`, also keine neuere Version
als der aktuelle Desktop `2.1.2`. Der lokale Abruf von `/opencode/feed/latest.yml`
lieferte außerdem HTTP 404. Ein vollständiger Download-/Installationslauf ist
damit durch diese Diagnose nicht nachgewiesen. Der laufende Container und seine
Konfiguration wurden nicht verändert.

Die Client-Auflösung bindet den exakt passenden Feed-Pfad jetzt an die konfigurierte
Origin zurück, auch bei einer einzelnen nichtleeren `beta`-Query. Andere externe
Pfade, Schemes, URL-Zugangsdaten und Fragmente werden weiterhin abgewiesen.
Ein direkter Abruf mit dem korrigierten Quellcode lieferte den Feed unter
`http://localhost/opencode/feed` ohne die vorherige URL-Ablehnung.

### Beta-Upload: HTTP 413 im Admin-Proxy

Der 281.704.498 Byte große Upload überschritt das Nginx-Limit von 200 MiB.
Das Backend erlaubte bereits große Multipart-Anfragen. Das Proxy-Limit wurde
auf 1 GiB erhöht und im Admin-UI-README dokumentiert. Die Konfiguration bestand
`nginx -t` sowohl in einem temporären Container als auch im laufenden Admin-Proxy.
Die vorherige Konfiguration wurde lokal gesichert; anschließend wurde nur die
Proxy-Konfiguration mit `nginx -s reload` neu geladen. Das aktive Limit beträgt
1 GiB und die Admin-Oberfläche antwortet mit HTTP 200. Kein Image-Build und kein
Backend-Neustart wurden ausgeführt; den vollständigen ZIP-Upload wiederholt der Nutzer.

Der Nutzer hat den Upload anschließend erfolgreich wiederholt. Die Release-Liste
enthält Beta `2.1.2`. Mit dem aktiven AI-Factory-Zugang des lokalen Sidecars wurde
die echte Beta-Auswahl geprüft: Version `2.1.2`, Beta-Parameter vorhanden, Feed-Origin
`http://localhost`, `latest.yml` HTTP 200 und Metadatenversion `2.1.2`. Schlüssel und
Beta-Token wurden nur im Speicher verwendet und nicht ausgegeben. Diese Beta ist
nicht neuer als der laufende Desktop `2.1.2`; ein Download oder eine Installation
wurde nicht ausgelöst.

Abschließende Prüfungen: 22 Corporate-Updater-Tests und 21 vorhandene Updater-/Cache-Tests
bestanden; der Typecheck von `packages/gui-extensions` und `lint:changed HEAD` bestanden
ohne Probleme in den zwei geänderten TypeScript-Dateien. Es wurde kein Desktop gebaut
oder paketiert; die Client-Korrektur ist erst im nächsten Desktop-Build enthalten.

### Modellpreise und zentrale Sichtbarkeit

Die native Gesamtkostenanzeige summiert gespeicherte Sitzungskosten. Im Provider
wurden Model Cards bisher nur nach fehlgeschlagener Modell-Discovery geladen;
bei erfolgreichem `/models` fehlten dadurch die Preise. Der lokale Model-Card-Endpunkt
lieferte für `glm5.3` tatsächlich Preise, während die laufende CLI Nullpreise meldete.
Model Cards werden nun auch bei erfolgreicher Discovery geladen. Konkrete Modellnamen
haben bei der Preiszuordnung Vorrang vor allgemeinen Konfigurationsmustern wie `*`.
Die Kostenberechnung gilt für neue Provider-Turns; historische Nullkosten werden
nicht nachträglich mit heutigen Preisen überschrieben.

Der lokale zentrale Provider-Config-Endpunkt liefert `whisperx-large-v3` mit
`visible: false`. Der App-Adapter übernahm zuvor auch serverseitig deaktivierte
Modelle und verlor deren Freigabestatus. Er entfernt solche Modelle jetzt aus dem
UI-Katalog und berücksichtigt sie auch nicht mehr als Provider-Standard. Lokale
Sichtbarkeitsschalter können sie damit nicht erneut zur Auswahl hinzufügen.
Die zuvor korrigierte Übergabe der lokalen Update-URL an eine neue CLI ist ebenfalls
erforderlich, damit diese denselben zentralen Katalog wie die lokale Admin-Oberfläche liest.

Verifiziert: sechs Provider-Tests mit lokalem HTTP-Server, darunter erfolgreiche
Discovery mit Model-Card-Preisen, unterschiedliche Preise bei gleichen Wildcard-Mustern,
unveränderte Modell-Discovery bei fehlgeschlagenem Kartenabruf und nichtleere Kosten
durch die echte `SessionUsage.record`-Berechnung. Neun App-Adaptertests und die
Typechecks in Core und App bestehen. Keine Gesamtbuilds, Paketierung, Neuberechnung
historischer Sitzungen oder Neustarts wurden ausgeführt.

### MCP-Änderungen während laufender Agent-Aktionen

MCP-Speichern schreibt die Konfiguration und verbindet den Server über `mcp.add`
zur Laufzeit. `ToolsChanged` aktualisiert die Tool-Registry; die Sitzung liest
den Katalog vor jedem Provider-Turn neu. Eine schon laufende Modellantwort
behält ihren bisherigen Snapshot, die nächste Anfrage übernimmt den neuen.
Ein Neuladen der App oder Neustart der Unterhaltung ist dafür nicht erforderlich.

Das Ändern oder Entfernen einer bestehenden MCP-Verbindung kann dagegen einen
laufenden MCP-Tool-Aufruf beeinträchtigen. Solche Änderungen sollen bei aktiven
Sessions erst nach Bestätigung angewendet werden. Abbrechen lässt sowohl die
Konfiguration als auch die Verbindung unangetastet und erhält die Formulareingaben.
Neue MCPs können ohne Unterbrechung zusätzlich verbunden werden. Die Bestätigung
verwendet alle laufenden Sessions des Servers (`session.active()`), einschließlich
Hintergrund-Sessions. Sie wird vor dem Konfigurationsschreiben geöffnet. Auch Escape,
Schließen und Abbrechen verwerfen die Aktion; nach Zustimmung wird nur die
betroffene MCP-Verbindung geändert, nicht die Unterhaltung neu gestartet.

Verifiziert: zwei gezielte Backend-Tests zu laufender MCP-Rekonfiguration und
Tool-Katalogänderungen, drei Operationstests, App-Typecheck und vier Browserfälle.
Der Browser prüft insbesondere fehlende API-Schreibzugriffe vor Zustimmung sowie
bei Ablehnung, erhaltene Eingaben, erfolgreiche Zustimmung, abgebrochenes Löschen
und Trennen, Hinzufügen während einer aktiven Session und bestehende Editierfälle.
Die Korrektur wurde nicht gebaut oder paketiert; App und Server bleiben unverändert
in Betrieb, bis der Nutzer einen neuen Desktop-/CLI-Build verwendet.

### OAuth-Vorgabe aus dem MCP Store

Der lokale Store liefert für TiRex2 und rrz-devops `oauthRequired: false` und für
alfresco `true`. Das Feld fehlte im öffentlichen Store-Schema und ging dadurch beim
Decodieren verloren. Es ist jetzt optional im Schema enthalten; der Client wurde
mit `bun run generate` aus `packages/client` neu generiert.

Store-Installationen setzen OAuth nur bei `oauthRequired: true` auf aktiv und sonst
explizit auf `false`. Ein Remote-Formular ohne OAuth-Konfiguration startet ebenfalls
mit ausgeschaltetem OAuth statt fehlende Angaben als aktiv zu interpretieren.
Explizit vorhandene OAuth-Konfigurationen bleiben erhalten; bestehende Dateien oder
Sitzungsdaten wurden nicht automatisch geändert.

Verifiziert: zehn Core-Decoder-/Store-Tests, zwölf App-Modell-/Operationstests,
fünf Browser-Komponententests und die Typechecks von Schema, Core und App.
Der Browser prüft beide Store-Vorgaben, die OAuth-freie Bearbeitung eines PAT-MCPs
mit erhaltenem Header und die vorherige Bestätigungslogik bei laufenden Sessions.
Kein Gesamtbuild, keine Paketierung und kein Neustart wurden ausgeführt.

### Modell-Ausblendung und CLI-Wiederverwendung bei gleicher Version

Live geprüft: Der lokale Updater liefert für `whisperx-large-v3` `visible: false`,
der weiterlaufende Dienst dagegen `enabled: true` und keine Modellpreise. Sein
Executable liegt noch unter `cli/2.1.2-x64/opencode-cli.exe`. Der Desktop hat bisher
sowohl die staged CLI als auch einen laufenden Dienst allein anhand der Version
wiederverwendet, sodass neue Frontends weiterhin die alte Backend-Implementierung
nutzen konnten.

Gebündelte CLIs erhalten jetzt einen SHA-256-Fingerabdruck, der inkrementell gelesen
und zwischen frühem Probe und Resolver geteilt wird. Das Staging berücksichtigt
Version, Architektur und Fingerabdruck. Der Dienst registriert den übergebenen
Build-Fingerabdruck; Discovery und Ensure prüfen ihn zusätzlich zur Versionsnummer,
auch im frühen Desktop-Probe. Clients ohne Build-Vorgabe bleiben kompatibel.
Eine geänderte CLI wird so beim nächsten normalen Desktopstart erkannt; der aktuelle
Nutzerdienst wurde während dieser Arbeit nicht gestoppt oder verändert.

Zusätzlich hat eine explizite Sichtbarkeitsregel jetzt Vorrang vor der Auswahl eines
Standardmodells. Ohne explizite Regel können konfigurierte Standardmodelle weiterhin
die bisherigen Standard-Ausblendungen überschreiben.

Verifiziert: 49 Client-Service-Tests (vier bestehende Windows-Skips), fünf Desktop-
Staging-Tests, sechs Provider-Tests und ein echter CLI-Registrierungstest. Der
Provider-Regressionstest scheitert mit der bisherigen Priorität und besteht mit
der Korrektur. Typechecks von Client, CLI, Core und Desktop bestanden; Linting der
geänderten TypeScript-Dateien ohne Warnungen. Kein Gesamtbuild oder Packaging.

Beim Testen hat ein Subagent irrtümlich den vorhandenen `ai-gilde-updater`-Stash
angewendet und danach das Arbeitsverzeichnis zurückgesetzt. Die eigenen Änderungen
wurden vollständig aus den protokollierten Patches rekonstruiert und erneut geprüft.
Der ursprüngliche Stash `c71c9db78ab17b34db5b9daf6e8dde0a8b9992b7` ist weiterhin
vorhanden; seine Updater-Änderungen wurden nicht übernommen.

### Sprungpunkte im Nachrichtenverlauf

Die vorhandene MessageNav-Komponente ist wieder in die Desktop-Sitzungsansicht
eingebunden: schmale Leiste links, Prompt-Vorschau beim Darüberfahren und Sprünge
per Maus oder Tastatur über die bestehende Hash-/Virtualizer-Navigation. Sie zeigt
den aktuellen Abschnitt, wächst mit nachgeladenen Nachrichten und berücksichtigt
die bestehende Revert-Filterung. Unter 768 px bleibt sie ausgeblendet. Die Leiste
reserviert eigenen Platz, statt Nachrichten zu überdecken. Im angehefteten Verlauf
ist keine zusätzliche DOM-Abfrage pro Streaming-Frame notwendig.

Verifiziert: App- und Session-UI-Typecheck, gezieltes Linting ohne Befunde sowie ein
Browser-Regressionstest mit langem, paginiertem Verlauf, Hover-Vorschau, Klick,
Enter, sichtbarem Sprungziel und mobiler Ausblendung. Der Test schlägt gegen den
bisherigen Produktionsbuild wegen der fehlenden Leiste erwartungsgemäß fehl.
Produktionsbaseline aus vorhandenem dist: Cold-Session-Einstieg 349 ms erste
korrekte Darstellung / 376 ms stabil. Nachher im Dev-Server: 877 / 905 ms, jeweils
ohne falsche Zielnachrichten und mit 0 px unterem Ankerfehler. Wegen unterschiedlicher
Build-Modi ist daraus keine belastbare Performance-Differenz ableitbar; ein neuer
Produktionsvergleich bleibt bis zum nächsten vom Nutzer gestarteten Build offen.
Gemäß Nutzervorgabe kein Gesamtbuild, keine Paketierung und kein App-/Serverneustart.

### Anbieter-Auswahl begrenzen

Der Desktop bietet nur AI Factory, OpenAI und GitHub Copilot an. Die gemeinsamen
UI-Kataloge filtern sowohl verfügbare Integrationen als auch verbundene Anbieter
und deren Standardmodelle. Dadurch erscheinen auch gespeicherte oder zuletzt
verwendete Modelle anderer Anbieter nicht erneut im Chat-Selektor. Gespeicherte
Verbindungen und Backend-Plugins bleiben unangetastet.

Der Verbindungsdialog bietet keine benutzerdefinierten Anbieter mehr an und weist
ausgeschlossene IDs beim direkten Öffnen zurück auf die Auswahl. Die OpenAI-
Anmeldewege für ChatGPT/Codex sowie Copilot bleiben erhalten. AI Factory steht im
Modellselektor zuerst; Modellzeilen und Gruppen verwenden dieselbe Anbieterfolge,
damit auch die Tastaturnavigation dazu passt.

Verifiziert: beide Browser-Fälle in `model-selection-flow.spec.ts`, App-Typecheck
und Linting ohne Befunde. Die Browser-Prüfung enthält einen bereits verbundenen,
lokal sichtbar und zuletzt verwendet gespeicherten ausgeschlossenen Anbieter,
AI-Factory-Priorität, OpenAI-/Copilot-Auswahl, den beschränkten Verbindungsdialog
sowie erhaltene Modell-/Variantenauswahl beim Sitzungswechsel. Gegen das vorherige
dist schlägt der Ausschluss-Test erwartungsgemäß fehl. Kein Gesamtbuild/Packaging.

### Startverzögerung im signierten Prod-Build

Am 22.10.2026 anhand `dist-v18.29-ai-signed/win-unpacked` und der Desktop-Logs
diagnostiziert: Fenster und Hauptprozess sind nach wenigen hundert Millisekunden
bereit. CLI-Hash und erstmaliges Staging benötigen zusammen rund 550 ms. Die CLI
registriert sich unter `service-prod.json`, während Desktop-Ensure und früher Probe
weiter `service.json` lesen. Die dortige Registrierung gehört zum alten, nicht mehr
laufenden Dienst. Dadurch bleibt die Oberfläche trotz gesundem neuen Dienst wartend.

Der Desktop übernimmt jetzt den unveränderten CLI-Buildkanal zusätzlich zur
Desktop-Produktidentität. Beide Verbindungswege verwenden dieselbe Dateinamensregel
wie die CLI: prod → service-prod.json, local → service-local.json, die gemeinsamen
Releasekanäle → service.json. Die vorhandene lokale Entwicklungs-Übersteuerung
bleibt erhalten; heruntergeladene Entwicklungs-CLIs nutzen weiterhin service.json.

Read-only am laufenden Dienst geprüft: Health HTTP 200 in 4 ms; Discovery über den
korrigierten Prod-Pfad inklusive Hash des konkreten gebündelten Executables in
291 ms erfolgreich (davon 285 ms Hash). Dreizehn gezielte Kanal-/Buildkonfigurations-
Tests und Desktop-Typecheck bestanden. Lint ohne Fehler; vier bestehende
Abstandswarnungen in unberührten Abschnitten der Buildkonfigurationstests.
Kein Gesamtbuild, keine Änderung am gebündelten Build und kein App-/Dienstneustart.

### Modellregeln während laufender Desktop-Sitzungen aktualisieren

Live-Diagnose: Der Prod-Dienst hatte noch einen alten verwalteten Regelstand ohne
die Ausblendung von GLM-OCR und Qwen3.8-27B-FP8. Der aktuelle Updater-Abruf mit dem
aktiven AI-Factory-Key liefert beide Ausblendungen. Der unautorisierte Browserabruf
liefert einen anderen Regelumfang; die keyabhängige Konfiguration bleibt maßgebend.

Der Provider aktualisiert die verwalteten Modellregeln jetzt alle 30 Sekunden und
umgeht dabei den sonst fünf Minuten gültigen HTTP-Cache. Modelle und Preise werden
bei diesem Policy-Abruf nicht erneut abgefragt. Identitätswechsel und lokale
Konfigurationsereignisse laufen weiterhin über den vollständigen Ladeweg; eine
Semaphore serialisiert beide Wege. Nur tatsächliche Katalogänderungen lösen die
bestehenden Provider-/Model-Updated-Ereignisse für die Oberfläche aus.

Config hält lokale Dokumente einschließlich Projektregeln vor dem entfernten
Overlay separat bereit. Der beim Start geladene Remote-Snapshot kann dadurch
gelöschte Ausblendregeln nicht wiederherstellen. Bei fehlgeschlagenem oder
ungültigem Abruf bleibt der letzte gültige, URL-/Key-spezifische Stand erhalten;
eine gültige leere Konfiguration kann Regeln bewusst entfernen. MCP-Konfiguration
und laufende Agent-Aktionen werden bei diesem Refresh nicht neu geladen.

Verifiziert: zwölf Tests / 67 Assertions für Provider, Config-Cache und Corporate-
Konfiguration, inklusive Hide/Unhide per TestClock, nur einmaliger Modelldiscovery,
entferntem Start-Snapshot, erhaltenen Projektregeln, HTTP-Fehlern und ungültigem
JSON. Der Snapshot-Regressionstest scheitert mit dem früheren Merge-Verhalten.
Core-Typecheck und Linting bestanden. Kein Gesamtbuild, keine Änderung am
laufenden Nutzerdienst und keine Änderung am Updater-Backend.

### MCP-Dialog beim ersten Öffnen

Der automatisch fokussierte Name lag direkt am Rand des scrollbaren Formulars.
Dadurch wurde der drei Pixel breite Fokusrahmen seitlich abgeschnitten. Vier Pixel
Innenabstand im Scrollbereich erhalten den vollständigen Rahmen; der äußere
Formularabstand und die große, viewportbegrenzte Dialoggröße bleiben erhalten.

Die im Port fehlenden Platzhalter aus dem alten Dialog wurden für Name, Befehl,
URL, Header und OAuth-Client-ID/Scope wieder ergänzt. Store-spezifische Header-
Hinweise und der Hinweis auf den automatisch verwendeten AI-Factory-Key haben
weiterhin Vorrang. Neue i18n-Keys sind ausschließlich in der englischen Quelle.

Verifiziert: Der erweiterte bestehende MCP-Komponententest scheiterte vor der
Layoutkorrektur mit null Pixel Abstand zum Scrollrand. Danach bestehen alle fünf
MCP-Browsertests einschließlich erstem Autofokus, Platzhaltern, kleinem Viewport,
Speichern, OAuth und Unterbrechungsbestätigung. App-Typecheck bestanden; Lint ohne
Fehler, bestehende Warnungen im Dialog unverändert. Kein Gesamtbuild und keine
Änderung am laufenden Desktop oder Hintergrunddienst.

### Dokumente, OCR und Vision Recall

V2 registriert jetzt `document_search`, `document_summary`, `document_ocr` und
`vision_recall`. Anhänge und PDF-Ergebnisse des Read-Tools werden vor der
Modellanfrage nach der jeweiligen Modellregel verarbeitet. Native PDF-/Bilddaten
gehen nur bei aktivierter Fähigkeit direkt zum Modell; sonst wird lokaler Text
indexiert bzw. auf die konfigurierten OCR-/Vision-Worker verwiesen. Verborgene
Worker bleiben für diese Aufgaben verfügbar, ohne im Chat auswählbar zu werden.

Originale und extrahierte Seiten liegen in einem persistenten, nach Session und
Inhalt getrennten Cache. OCR-Ergebnisse stehen danach auch für Suche und
Zusammenfassung zur Verfügung. Visuelle Abfragen rendern maximal vier konkrete
PDF-Seiten, sequenziell und mit begrenzten Bildabmessungen. Summaries verarbeiten
alle indizierten Inhalte in begrenzten Abschnitten und verdichten die Ergebnisse
erneut, statt unbeschränkt große Abschlussanfragen zu erzeugen. Trunkierte Worker-
Antworten werden als Fehler ausgewiesen. Office-Text erhält keine erfundenen
physischen Seitenangaben.

Word/Excel und weitere Office-Formate werden lokal durch AnyDoc WASM gelesen;
PDF.js und Canvas liefern PDF-Text und Seitenbilder. Die Module werden erst beim
Dokumentzugriff geladen. Es gibt keine hosted Firecrawl-OCR. Erstellen und
Bearbeiten bleiben Aufgabe verbundener MCP-Tools. Neue Lizenzen sind unter Über
aufgeführt. Binäre Office-Anhänge werden nicht mehr vor der Verarbeitung verworfen.

`provider-config.json` steuert direkte PDF-/Bildeingaben, Worker sowie erlaubte
Reasoning-Stufen und deren Standard. Explizite Stufen ersetzen die automatisch
erzeugte Liste; gleichnamige frische zentrale Regeln verdrängen lokale Altstände.
Die Dokumentpolicy bleibt intern und wird nicht als Provideroption versendet.

Verifiziert: 165 Core-Tests einschließlich realer PDF-/DOCX-/XLSX-Fixtures,
vollständigem Tool-/Hook-/HTTP-Weg über lokale Test-Worker, verborgenem Worker,
seitengenauem Recall, OCR-Folgesuche, Cache-Persistenz/Session-Trennung, nativer
PDF-Policy und Fehlerdarstellung; 13 Composer-Tests. Ein absichtlich eingefügter
PDF-Policy-Bypass lässt die neuen Integrationstests scheitern und wurde wieder
entfernt. Typechecks für Core, App, CLI und Desktop bestanden. Ein kleiner
isolierter Bun-Compile-Test verarbeitet RTF, PDF-Text und PDF-Seitenbilder auch
ohne node_modules im Arbeitsverzeichnis. PDF.js meldet dabei seine erfolglose
redundante Canvas-Suche; die explizit eingebetteten Adapter rendern erfolgreich.
Kein vollständiger Desktop-/CLI-Build und kein Neustart der laufenden Anwendung.

### Drei Konfigurationsstufen im Updater

Die bereits vorbereitete AI-Gilde-Release-/Tester-Verwaltung wurde aus dem
unveränderten Nutzer-Stash gezielt in den aktuellen Stand übernommen. Model Status
bietet Beta, AI Gilde und Normal. Pro Modell wird die passende Limit-/Dokument-/
Reasoning-Regel einschließlich Sichtbarkeit einmalig aus der Vorstufe übernommen:
Beta nach AI Gilde, AI Gilde nach Normal. Wildcards werden nur für das gewählte
Modell materialisiert. Andere Modelle und globale Modellvorgaben bleiben erhalten;
spätere Quelländerungen wandern nicht automatisch weiter.

Der aktive API-Key wählt die entsprechende Provider-Konfiguration. Neue
AI-Gilde-Einstellungen liegen ohne separaten Bind-Mount im vorhandenen data-Volume;
eine bereits bereitgestellte appsettings.ai-gilde.json wird weiterhin verwendet.
Release-Metadaten dürfen bei fehlenden Angaben weiterhin Normal als Fallback
nutzen, während Modellregeln getrennt bleiben. Die Release-Promotion behält ihr
korrektes Datenbankziel und kopiert Normal-Releases in den Feed-Hauptordner.

Verifiziert: isolierter HTTP-Test mit drei temporären Konfigurationen und lokalem
LiteLLM-Testserver, 37 Assertions für Promotion, Trennung, Sichtbarkeit,
Wildcard-Materialisierung, fehlende Regeln, ungültige Kanäle, Legacy-API-Alias,
persistentes data-Verzeichnis und Release-Metadaten-Fallback. Angular-Templates
kompilieren mit ngc --noEmit; .NET-Compile erfolgreich. Die bestehende NU1903-
Warnung für SQLitePCLRaw.lib.e_sqlite3 2.1.11 bleibt unverändert. Kein Docker-Build,
Deployment oder Eingriff in persönliche Konfigurationsdateien.

### Plugin-Abhängigkeiten und Fehlerisolation

Die v2-CLI initialisiert die eingebettete Plugin-Laufzeit vor dem Serverstart.
Lokale Plugins können dadurch `@opencode/plugin` und Effect ohne eigene
node_modules-Kopien importieren. Die Paketinstallation erfolgt über Arborist
innerhalb der Bun-Laufzeit; ein separates node.exe wird dafür nicht gestartet.
Externe Programme, die ein Plugin selbst aufruft, sind davon unabhängig.
Alte Imports wie `@opencode-ai/plugin` werden nicht automatisch zur v2-API
umgeschrieben.

Lade-/Setupfehler werden im Plugin-Inventar erfasst, ohne die gesunde Generation
zu verwerfen. Fehlgeschlagene State-Transforms deaktivieren die betroffenen
Registrierungen samt Hooks und RPC-Handlern. Die bestehenden 32 Tests dieser
Grenzen bestanden. Zwei zusätzliche Regressionstests prüfen ein eigenständig
geladenes Plugin ohne lokale SDK-/Effect-Installation und einen realen
Location-Start mit fehlendem SDK-Import sowie fehlendem Laufzeitprogramm.
Beide bestehen; Core-Typecheck erfolgreich. Dies ist keine Zusage, beliebige
externe Programme oder jede inkompatible ältere Plugin-API einzubetten.

Unter Erweiterungen / Plugins bleiben fehlgeschlagene externe Plugins sichtbar,
mit Fehlerstatus und gekürzter, bereinigter Fehlermeldung. Änderungen am
Plugin-Inventar aktualisieren die Liste. „Repair with agent“ öffnet einen
Bestätigungsdialog und danach einen eigenen Chat-Entwurf mit Quelle,
Arbeitsverzeichnis und Fehlerreferenz. Der Agent wird erst nach Absenden tätig;
bestehende Chats und Entwürfe werden nicht überschrieben. Der vorbereitete Text
enthält keine rohe Fehlermeldung und bittet um Diagnose, Reparatur und Prüfung
der Chat-Funktion. Drei gezielte Kontext-/Redaktions-Tests sowie App-Typecheck
bestanden; keine vollständige Desktop-Build- oder Installer-Ausführung.

### Installer-Pfad und Playwright-Audit

Im aktuellen Packaging ist keine Playwright-Mitlieferung eingerichtet.
Playwright und seine Browser erscheinen in Entwicklungs-/Testabhängigkeiten,
nicht in den Desktop-Laufzeitabhängigkeiten oder extraResources. Es wurden keine
Browserpakete entfernt oder zusätzlich eingebaut.

Der Installer setzt `$INSTDIR` jetzt auch in `customInit` auf
`C:\Entwicklung\OpenCode`, nach der NSIS-Auswertung bisheriger Installationsdaten
und `/D`-Parameter. Der Updater-Helper verwendet diesen festen Pfad bereits.
Zwei kleine NSIS-Vertragstests bestanden, einschließlich vorgegebenem früherem
Pfad und `/D`-Aufruf; die Testprogramme schreiben ausschließlich in temporäre
Verzeichnisse und installieren keine Desktop-Anwendung. Kein vollständiger
Build, keine Ausführung des tatsächlichen Produktinstallers.

### Legacy-Encodings und internes AI-Factory-Routing

Edit, Write und Patch behalten bei bestehenden Windows-1252-Dateien das
erkannte Encoding und die Zeilenenden. Die Tests decken Umlaute, ß und das
Eurozeichen als einzelne Legacy-Bytes ab. Nicht darstellbare Zeichen werden
vor dem Schreiben abgewiesen; neue Dateien verwenden weiterhin UTF-8.
Erkannte UTF-16-/UTF-32-BOMs werden ausdrücklich zurückgewiesen, da diese
Encodings derzeit nicht unterstützt werden. Sie dürfen nicht als Windows-1252
interpretiert und überschrieben werden. Read und FileMutation übersetzen diese
Dekodierungsfehler in reguläre Tool-Fehler. Der Patch-Test prüft auch, dass in
diesem Fall keine früheren Patch-Operationen geschrieben werden.

Die interne Gateway-IP 10.53.7.23 und ihr Alias ai.proxy01.ksq.at bleiben jetzt
unabhängig vom aktuell konfigurierten Host und NO_PROXY direkt geroutet. Die
Bypass-Einträge werden auch an Kindprozesse weitergereicht. Der konfigurierte
AI-Factory-Host bleibt zusätzlich freigestellt. Die vorhandenen Parameter
`aifactory_host` und `use_http_proxy` bleiben erhalten: false deaktiviert den
Proxy global, einschließlich Websearch/Webfetch; true aktiviert ihn für
externe Ziele, während AI Factory weiterhin direkt angesprochen wird.

Websearch verwendet ohne explizite Auswahl jetzt wieder Exa statt des
Upstream-Dialogs mit anschließend zufälliger Anbieterwahl. Explizite Auswahl
eines anderen Anbieters oder eine Abschaltung bleiben wirksam. Der Service-Test
prüft die Standardwahl auch mit einem tatsächlichen AI-Factory-Modellkontext;
der Tool-Test prüft den vollständigen Aufruf ohne zusätzlichen Auswahl-Dialog.
Die bisherigen Dialog-Tests gelten weiter für Installationen ohne Exa.
Der Windows-PowerShell-Transport erhält seine Proxy-Umgebung jetzt pro Aufruf.
Webfetch verwendet bereits den gemeinsamen HTTP-Client; zusätzlich nutzt nun
auch der ältere AI-SDK-Transport denselben proxybewussten Fetch-Adapter.

Verifiziert: 370 Core-Tests und 16 Utility-Tests bestanden, ein bestehender Test
übersprungen; Typechecks für Core, CLI und Utilities sowie Lint erfolgreich.
Reale lokale HTTP-/Proxy-Tests decken Bun, Node und den Windows-PowerShell-Pfad
ab. Bewusstes Entfernen des Gateway-Bypasses bzw. des Exa-Defaults lässt die
zugehörigen Regressionstests scheitern; die Änderungen wurden anschließend
wiederhergestellt und die Tests erneut erfolgreich ausgeführt. Kein externer
Such-/Modellaufruf, keine persönliche Konfigurationsänderung, kein vollständiger
Build und kein Neustart der Anwendung.

### PDF-Canvas in der CLI-Artefaktprüfung

Die Artefaktprüfung darf die gemeinsam genutzte Canvas-Bibliothek und ihre
nativen Skia-Bindings nicht pauschal als Simulationscode einstufen. Diese
Sperreinträge wurden entfernt; konkrete Simulations-PNG- und Screenshot-Font-
Marker bleiben gesperrt. Der Modulgraph-Sammler erfasst zusätzlich
frontend/png.ts, damit die vorhandene PNG-Graphprüfung tatsächlich greifen
kann. Der Scanner schließt seinen Dateistream auch bei einer Ablehnung.

Das vorhandene eigenständige PDF-/Office-Compile-Testprogramm bestand nach der
Korrektur die Artefaktprüfung. Es wurde kein neuer vollständiger CLI- oder
Desktop-Build ausgeführt. PDF-Verarbeitung, AnyDoc-Aufrufe und Netzwerkrouting
wurden durch diese Korrektur nicht geändert.

Der gezielte Verifier-Test akzeptiert PDF-/Canvas-/Skia-Artefakte, weist
Simulations-PNG-/Screenshot-Font-Marker und leere Artefaktverzeichnisse ab und
prüft die PNG-Sperre im vollständigen Bridge-Modulgraph. Test, CLI-Typecheck,
Lint und Diff-Prüfung bestanden.

### Große Dokumentanhänge beim Senden

Die Base64-Prüfung im gemeinsamen Prompt-Schema weist große gültige Anhänge
unter Bun/JavaScriptCore fälschlich ab. Der Fehler entsteht vor der AnyDoc-
Extraktion und führt beim Senden zu HTTP 500. Mit der lokal bereitgestellten
10,47-MiB-Präsentation wurde die Ablehnung reproduziert; AnyDoc kann dieselbe
Datei lokal erfolgreich extrahieren. Die Datei selbst wird weder in Tests
übernommen noch hochgeladen.

Ein synthetischer 12-MiB-Anhang reproduziert den Fehler im tatsächlichen
Session.prompt-Pfad einschließlich dauerhafter Aufnahme. Die gemeinsame
Validierung verwendet künftig eine flache Alphabet-/Padding-Prüfung mit
separater Längenprüfung; das akzeptierte Base64-Format bleibt unverändert.

Verifiziert: 51 Core-Tests und drei Schema-Tests erfolgreich, Typechecks für
Core und Schema sowie Lint bestanden. Client-Generierung erfolgreich ohne
Änderung generierter Dateien; die serialisierte Schema-Beschreibung bleibt
erhalten. Die Originaldatei besteht nun Validierung und lokale Extraktion.
Kein vollständiger Build, kein Modellaufruf und kein App-/Service-Neustart.

### Excel-Zusammenfassungen mit Reasoning-Modellen

Die gemeldete Arbeitsmappe wird lokal vollständig extrahiert: drei Blätter,
52.408 Zeichen. Die 18.000-Zeichen-Vorschau ist absichtlich begrenzt; die
vollständige Extraktion bleibt im Dokumentcache. Das gesuchte Wort
„Arbeitspaket“ kommt nicht vor und erklärt den leeren Suchtreffer.

Die Zusammenfassung verwendete hingegen nur 2.048 Ausgabe-Tokens pro Chunk.
Das ist bei Reasoning-Modellen auch das Budget für die interne Herleitung und
kann vor der eigentlichen Antwort erschöpft sein. Das Summary-Budget wird auf
8.192 angehoben und weiterhin am konfigurierten Modelllimit gedeckelt.
Ein Abbruch wegen Tokenlimit wird vor einer leeren Antwort erkannt; es gibt
keinen automatischen zweiten Modellaufruf und keinen Ersatz durch Reasoning.
Die konkrete Finish-Reason der früheren Antwort wurde nicht gespeichert und
ist aus dem Screenshot allein nicht abschließend feststellbar.

Lokale HTTP-Regressionen prüfen reine Reasoning-Ausgabe mit Tokenlimit,
eine leere regulär beendete Antwort, das erhöhte Budget und dessen Begrenzung
auf ein niedriger konfiguriertes Modelllimit. Eine lange synthetische
Arbeitsmappe wird vollständig in fünf Chunks plus Zusammenführung verarbeitet;
auch die letzte Zeile jenseits der Vorschau erreicht den Worker. Testantworten
werden lokal erzeugt, ohne Unternehmensdokumente an ein Modell zu senden.

Verifiziert: zehn Dokumenttests, Core-Typecheck, Lint und Diff-Prüfung
erfolgreich. Kein vollständiger Desktop-Build oder Neustart.

### Nachrichten-Ribbon als einzelne Hover-Vorschau

Das kompakte Ribbon zeigt kurze, dezente Markierungen und betont die aktuelle
sowie überfahrene Nachricht. Statt einer vollständigen Liste mit Diff-Balken
öffnet sich eine einzelne abgerundete Karte neben der betreffenden Markierung:
Nutzerfrage als Titel, bis zu drei Zeilen Antworttext als Vorschau. Reasoning
und Tool-Inhalte werden nicht als Antwortvorschau verwendet.

Ein gemeinsames HoverCard bleibt erhalten; beim Wechsel der Markierung wandert
sein Anker. Es werden keine Popups pro Nachricht oder zusätzliche Datenabfragen
angelegt. Die Karte bleibt beim Übergang mit der Maus erreichbar. Klick,
Enter/Leertaste und Escape werden unterstützt, die normale Listenvariante
bleibt erhalten. Bestehender E2E-Keeper um diese sichtbaren Verträge erweitert;
Screenshot im Browser geprüft.

Vorher-Messung am vorhandenen Produktionsbundle: Cold-Session-Einstieg erstmals
korrekt nach 1.622 ms, stabil nach 1.645 ms. Derselbe Ablauf nach der Änderung
im lokalen Entwicklungsserver: 928/949 ms, Szenario erfolgreich. Diese Werte
sind wegen unterschiedlicher Build-Modi nicht als Performancegewinn vergleichbar.
Ein belastbarer Produktionsvergleich nach der Änderung bleibt bis zum nächsten
freigegebenen Build offen; es wurde kein vollständiger Build gestartet.

Verifikation: Ribbon-E2E-Keeper erfolgreich, App- und Session-UI-Typechecks,
Lint und Diff-Prüfung erfolgreich. Der zusätzliche gesamte E2E-Typecheck
scheitert in unveränderten Testdateien (Terminal-/Timeline-Probes, Composer,
Review und Timeline-Stream); keine Meldung betrifft den Ribbon-Keeper.

### Summary-Ausgabelimit aus der Modellkonfiguration

Auf Nutzerwunsch entfällt die zusätzliche feste Summary-Grenze von 8.192 Tokens.
Jeder Summary-Chunk und die Zusammenführung verwenden das Ausgabe-Limit des
tatsächlich gewählten Modells. Bei fehlendem Modelllimit wird kein künstliches
Tool-Limit gesetzt; dann gelten die Provider-Vorgaben. Die separaten bestehenden
Vision-/OCR-Limits werden durch diese gezielte Änderung nicht angepasst.

Die tatsächlichen lokalen HTTP-Anfragen werden auf 32.000 Tokens bei entsprechend
konfiguriertem Modell, auf 4.096 bei niedrigerem Limit und auf fehlende explizite
Begrenzung bei unbekanntem Limit geprüft. Die Regressionen scheitern mit dem
vorherigen festen Tool-Limit.

Verifiziert: elf Dokumenttests, Core-Typecheck, Lint und Diff-Prüfung erfolgreich.
Kein vollständiger Build und kein Neustart.

### Changelog in den Desktop-Einstellungen

Die Updater-Erweiterung trägt wieder eine eigene Changelog-Seite zu den
Einstellungen bei. Markdown kommt über Desktop-IPC vom konfigurierten
Updater-Endpunkt `/changelog.md`, mit denselben vertrauenswürdigen Corporate-
Settings, Proxy-Einstellungen und dem AI-Factory-Key wie bei Updates. Der
Updater bestimmt damit weiterhin den Rollout-Kanal; der Renderer kann weder
Zieladresse noch Kanal vorgeben. Es wird kein GitHub-Changelog ersatzweise
geladen. Die separate bisherige What's-New-Funktion bleibt unverändert.

Die Seite hat eine Aktualisieren-Schaltfläche und ausdrückliche Lade-, Fehler-
und Leerzustände. Neue Provider-Generationen dürfen keinen alten Changelog
anzeigen; überholte Anfragen werden verworfen. Darstellung wird im Leerlauf
vorgeladen, der Markdown-Abruf erst beim Öffnen der Seite gestartet.

Verifiziert: 46 Updater-Tests, erfolgreicher Browser-Keeper für fehlgeschlagenen
Abruf, erneutes Laden ohne leere Einstellungen, Markdown und leeren Changelog.
Screenshot visuell geprüft. GUI-Extensions- und Desktop-Typecheck sowie
`lint:changed HEAD` erfolgreich; der laufende Updater liefert den bestehenden
Endpunkt bereits mit HTTP 200. Kein vollständiger Build, keine Auslieferung
und kein Neustart der Anwendung oder des Updater-Servers.

### Updater: verschwundene Promotions und Feedback-Abhängigkeit

Ursache des gemeldeten Problems: Release-Dateien lagen unter `/app/feed`, außerhalb
des vorhandenen Docker-Datenvolumes. Beim früher freigegebenen Container-Neuaufbau
gingen diese Dateien verloren, während die SQLite-Release-Einträge erhalten blieben.
Die bisherige Promotion änderte zuerst den Datenbankkanal; der anschließende
Kopiervorgang konnte scheitern und einen scheinbar promoteten Eintrag hinterlassen.

Die ursprüngliche 2.1.2-ZIP wurde lokal wiedergefunden und gegen die in der
Datenbank gespeicherte SHA-256-Prüfsumme sowie den Installer-SHA-512 aus latest.yml
geprüft. Ihr AI-Gilde-Feed wurde ohne Datenbankänderung und ohne Neustart
wiederhergestellt. Die währenddessen vom Nutzer hochgeladene Beta 2.1.3 wurde
erkannt und unverändert erhalten. Beide Stages wurden zusätzlich im bestehenden
Datenvolume unter `/app/data/feed` gesichert. Normal hat weiterhin einen
historischen Datenbankeintrag ohne zugehörige Paketdateien; dort wurde kein
anderes Paket ersatzweise veröffentlicht.

Die Admin-Oberfläche verwendet getrennte Beta-/AI-Gilde-/Normal-Karten und
manuelle Promotions ohne positives Feedback. Pending-, Erfolgs- und Fehlermeldungen
sowie gemeinsame Cache-Invalidierung ersetzen das bisher nötige F5. Stop und
Resume sind pro Stage vorgesehen. Feedback-Navigation entfällt; historische
Datensätze bleiben erhalten.

Backend: persistente Feeds in `data/feed/{beta,ai-gilde,normal}`, Migration ohne
Überschreiben vorhandener Stages, serialisierte Uploads/Promotions mit validiertem
Staging und Wiederherstellung des alten Zielfeeds bei Datenbankfehlern. Stoppflags
gelten pro Stage für Paket-/Versionsauslieferung und überstehen Neustarts;
Provider-Konfiguration und MCP bleiben erreichbar. Feedback-Schreibzugriffe
liefern HTTP 410, historische GETs bleiben mit `Deprecation: true` lesbar.

Verifiziert: .NET-Compile, Angular-Typecheck, 94 HTTP-Assertions in zwei isolierten
Server-Regressionen, Browserprüfung für unmittelbare Rückmeldungen, gemeinsame
Cache-Aktualisierung, Stopp/Fortsetzen und sichtbare Fehler. Oxlint ohne Meldungen.
Die bestehende NuGet-Warnung NU1903 zu SQLitePCLRaw bleibt unverändert.

Nach zusätzlicher ausdrücklicher Nutzerfreigabe wurden Backend und Admin-UI neu
gebaut und mit dem bestehenden Compose-Projekt samt Konfigurations-Binds und
Datenvolume gestartet. Vor dem Austausch wurden der gestoppte Runtime-Feed und
das Datenvolume lokal unter `opencode-updater-before-rebuild-1792681741456` im
Benutzer-Temp gesichert und die aktuellen Stage-Dateien ins Volume übernommen.
Produktiver Status und Browserprüfung bestätigen Beta 2.1.3 und AI-Gilde 2.1.2
mit vorhandenen Dateien, Normal 2.14.36 mit ausdrücklich fehlenden Dateien.
Es wurden keine Releases zusätzlich promotet oder produktiven Stoppflags geändert.

### Windows-Updater: HTTP-Client bei eigenem Cache

Der Screenshotfehler `Cannot read properties of null (reading 'request')` entstand
im Desktop, nicht im Updater-Server. Bei Übergabe eines eigenen AppAdapters lässt
electron-updater 6.8.9 seinen internen HTTP-Executor null. Der Adapter ist für den
konfigurierten Windows-Cache nötig. Eine kleine NSIS-Unterklasse initialisiert
nun denselben ElectronHttpExecutor einschließlich Login-Weiterleitung wie der
normale Updater-Konstruktor. Cache-Pfad, direkte Netzwerk-Session und bestehende
Installationsübergabe bleiben erhalten.

Die Regression führt einen echten Electron-Main-Prozess mit isolierten Benutzer-
und Cache-Verzeichnissen aus. Sie prüft den echten latest.yml-Abruf und Installer-
Download mit Prüfsumme und AI-Factory-Header am lokalen HTTP-Server. Der Test-
Installer wird nie ausgeführt. Acht Assertions erfolgreich; zusätzlich bestanden
die bestehenden 46 Corporate-/Cache-/State-Machine-Tests. Desktop- und GUI-
Extensions-Typechecks erfolgreich. Kein Desktop-Paket oder vollständiger Build.

### Updater-Port: Tester-Suche und MCP-Store-OAuth

Die Referenzfunktionen wurden in `ai-gilde-updater` gefunden. Der Server erhält
die namensbasierte LiteLLM-Tester-Suche zurück, ohne Schlüssel/Hashes an den
Browser auszugeben. OAuthRequired wird wieder aus vorhandenen Store-Einträgen
gelesen, beim Speichern erhalten und im öffentlichen Store ausgegeben; reine
OAuth-Einträge benötigen keine Header. Die OpenCode-MCP-Übernahme unterstützt
dieses Flag bereits (neun bestehende Model-Tests erfolgreich).

Der isolierte Backendtest prüft Suche, Deduplizierung, Management-Key-Weitergabe,
fehlende Schlüssel-Leaks, Fehlerantworten, erhaltene Tester-Gruppen und OAuth-
Roundtrips bis zur SQLite-Konfiguration (16 Assertions erfolgreich).

Die Admin-Oberfläche bietet wieder LiteLLM-Namenssuche, Plus-Schaltflächen zum
Zuordnen/Verschieben und Minus-Schaltflächen zum Entfernen. Bestehende Gruppen
bleiben erhalten und bearbeitbar. Listen und Suchtreffer wechseln erst nach
erfolgreichem Speichern; fehlgeschlagene Aktionen lassen die Zuordnung und
Gruppeneingaben unverändert. Namensvergleiche berücksichtigen unterschiedliche
Groß-/Kleinschreibung. Async-Rückmeldungen verwenden Angular-Signals.

Der MCP-Store-Editor bietet wieder OAuth required, übernimmt bestehende Flags,
akzeptiert OAuth-only-Einträge und zeigt die Anmeldeart in der Liste an. Auch
Speicherfehler und das Schließen des Editors werden unmittelbar sichtbar.

Verifiziert: Angular-Typecheck und Browser-Regressionslauf mit isolierten API-
Antworten für Suche, Zuordnen, Verschieben, erfolgreiches/fehlgeschlagenes Entfernen,
Gruppenerhalt und OAuth-only-Speichern samt erneutem Öffnen. Beide Screenshots
visuell geprüft. In diesem Folgeschritt wurden weder Container neu gebaut noch
produktive Tester-/MCP-Einträge verändert; die UI-/Server-Änderungen benötigen den
nächsten freigegebenen Updater-Neubau. Der Desktop-Fix benötigt einen neuen
Desktop-Build; kein vollständiger Desktop-Build wurde gestartet.

Nach erneutem Nutzerhinweis wurden Backend und Admin-UI am 22.10.2026 ausdrücklich
neu gebaut und ausgerollt. Der Live-Browsertest fand dabei einen weiteren Fehler
der übernommenen Tester-Suche: LiteLLM ignoriert `per_page` und begrenzt die
Standardseite auf zehn Schlüssel. Gemäß dem tatsächlichen LiteLLM-OpenAPI-Vertrag
verwendet die Suche nun `size=100`, `return_full_object=true` und den URL-kodierten
Suchbegriff als `search`; weiterhin werden nur Namen ausgegeben. Die verstärkte
Regression scheitert mit der alten Anfrage und besteht mit 17 Assertions.

Nach Auslieferung dieses Backend-Fixes bestätigt der Live-Browsertest echte
Treffer für die Namenssuche sowie Plus-/Minus-Schaltflächen und die OAuth-Option
im Store-Editor. Es wurden keine Tester oder Store-Einträge gespeichert. Die
persistenten Feeds Beta 2.1.3 und AI-Gilde 2.1.2 bleiben verfügbar. Der separate
Desktop-HTTP-Executor-Fix ist durch diesen Container-Neubau weiterhin nicht in
einem neuen Desktop-Paket ausgeliefert.

### Desktop-Neustart: Service-Dateisperre und ausgefallene Updater-Erweiterung

Ein kurzzeitiges Windows-Deny-Delete-Handle auf `service-prod.json` reproduziert
den gemeldeten Dienstabbruch beim atomischen Umbenennen der eigenen temporären
Registrierung. Nur unter Windows und nur bei Node-Fehlercodes EPERM/EACCES/EBUSY
wird das Rename nun bis zu 20-mal im Abstand von 100 ms wiederholt. Die bestehende
Registrierung wird nie vorab gelöscht oder in ihren Berechtigungen verändert.
Die eigene eindeutige TMP-Datei wird auch bei dauerhaftem Fehler und Unterbrechung
bereinigt. Eigentumsprüfung und Abschaltverhalten bleiben unverändert.

Drei Tests mit echten PowerShell-Dateisperren scheitern ohne Fix und bestehen mit
Fix: Freigabe nach kurzer Sperre, begrenztes Scheitern bei dauerhafter Sperre und
TMP-Bereinigung bei Unterbrechung. Zehn gezielte Registrierungs-/Eigentumstests
bestanden insgesamt; CLI-Typecheck erfolgreich.

Der graue Prüfbutton und der nicht verfügbare Changelog waren dagegen kein
versteckter Download. Das aktuelle Desktop-Log bestätigt, dass die gesamte Updater-
Erweiterung beim Import von `electron-updater/out/electronHttpExecutor` scheitert.
Beim vorherigen Fix fehlte die für native ESM erforderliche Endung `.js`. Der
Import ist korrigiert. Der echte Electron-Regressionslauf verwendet nun ESM mit
externem electron-updater statt eingebündelter CJS-Abhängigkeiten. Er reproduziert
mit dem alten Import denselben ERR_MODULE_NOT_FOUND und besteht mit dem korrigierten
Import einschließlich tatsächlichem Prüfen/Download, Cache und Auth-Header.

Die Einstellungen kennzeichnen fehlenden/deaktivierten Dienst ausdrücklich.
Prüfen, Herunterladen und Installieren zeigen zusätzlich einen Spinner und
aria-busy. Die zuvor fehlenden deutschen Changelog-Texte sind ergänzt. Der
produktive Changelog-Endpunkt antwortet mit HTTP 200; seine Nichterreichbarkeit
im Desktop entstand vor dem HTTP-Abruf. GUI-/Desktop-Typechecks und Changed-Lint
erfolgreich. Kein vollständiger Build, kein Anwendungsneustart und keine Änderung
an produktiven Service-/Konfigurationsdateien. Auslieferung beim nächsten
Desktop-/CLI-Build erforderlich.

### Corrected legacy updater identification (2026-10-22)
- User supplied dist-v37-ai-signed-1.zip. Its four entries are opencode-electron-win-x64.exe, blockmap, latest.yml version 1.14.37, changelog.md. It is Electron, not the parallel Tauri package in dev/packages/desktop. SHA-512 of the archive installer matches the supplied latest.yml.
- Earlier Tauri migration preparation was based on the wrong package identification and was reverted in full. No Tauri signing key or latest.json is required for this corporate Electron build. Also corrected the claim about missing AI Factory headers: the actual old Electron config client sends them and resolves tester stages.
- Controlled real Electron regression used the old Electron update-server.ts/update-server-trust.ts from origin/dev and old installed electron-updater library, isolated app version 1.14.37, local API/feed and never-executed installer fixture. Passed config request with test key, version comparison 1.14.37 -> 2.1.2, latest.yml resolution, new opencode-desktop-win-x64.exe filename, SHA-512 download verification and beta query token propagation. No installer or real user application executed/restarted. Test harness: legacy-electron-check.ts (ignored review artifact).
- Existing backend endpoints, new NSIS install path and app identity already support this update protocol. Actual old installed-client upgrade remains a release smoke test. No full build or live rollout done.

### SQLite security update (2026-10-22)
- Added an explicit SQLitePCLRaw.bundle_e_sqlite3 2.1.14 reference, overriding EF SQLite 10.0.0's transitive 2.1.11. Bundle/core/provider/native now consistently resolve to 2.1.14. No application API or database schema change.
- NU1903 advisory GHSA-2m69-gcr7-jv3q affects native SQLite before 3.50.2. Loaded the resolved win-x64 native DLL directly: sqlite3_libversion() reports 3.54.0.
- dotnet restore --force-evaluate with NuGetAudit=true, NuGetAuditMode=all and -warnaserror succeeded. dotnet build --no-restore: zero warnings/errors. dotnet list package --include-transitive --vulnerable: no known vulnerable packages.
- Existing backend release, model policy, tester/MCP integration tests: 3 pass, 111 assertions, using disposable databases/configuration. No live database changes, Docker rebuild/restart or full Desktop build.

### Legacy 1.18.29 update gate diagnosis (2026-10-22)
- Logs report 1.18.29 packaged and checking -> up-to-date before feed activity. In feat/merge-upstream-dev-v18:packages/desktop/src/main/updater.ts, compareVersions(current, remote) >= 0 returns no update, while update-server.ts returns positive when remote is newer. Thus 1.18.29 -> 2.1.2 is incorrectly rejected by that later legacy client. Earlier generic-feed compatibility checks from the separate desktop-electron path did not cover this gate.
- Current GUI extension platform already uses isUpdateNewer > 0 correctly. Added exact cross-major forward/reverse regression assertions. Corporate updater tests: 25 pass, 45 assertions; GUI extensions bun typecheck passes; lint:changed passes; direct oxlint of the touched test file has 0 warnings/errors.
- Documented the exception to old-client compatibility. No old checkout/installed client patched, no server versions falsified, no build/installer/restart. Affected 1.18.29 installations require one manual upgrade to a corrected client.

### Colleague startup failures (2026-10-23)
- Investigated oc.zip (three nested debug bundles) in a disposable temp directory. Packaged 2.1.2 resolves and stages the CLI, then service startup fails with spawn UNKNOWN before service readiness. Supplied logs have no corresponding successful service start and no captured mass-window restore. A historical --version entry alone does not establish that the staged executable can run.
- The installed binary is copied to userData/cli before launch. Endpoint protection, execution restrictions or damaged files remain hypotheses, not confirmed causes. User reports no security notification; Matrix42 / Raitec antivirus may be present.
- Added executable path and OS code/errno/syscall to both synchronous and asynchronous service-spawn errors, preserving original causes without copying arguments/environment. Desktop main logs now retain startup path/build identity and failure. No launch fallback, security bypass or destructive cache reset.
- Window restore now reuses an already-open window for the same ID, in addition to the previously committed persisted-ID deduplication. Added only restore counts to logs, not IDs/chat contents. Distinct persisted windows remain preserved; this is not proof that the colleagues' 100-window case is fixed.
- Added script/diagnose-windows-startup.ps1: hashes/signature status for installed and matching staged executables plus stored/distinct window counts. Optional -ProbeCli runs only --version with a 15-second timeout and retains native Windows error codes. No full settings/key export or configuration writes. Needs output from an affected colleague to continue root-cause diagnosis.
- Client tests: 8 pass, 28 assertions including actual missing and invalid Windows executables; Desktop registry/state tests: 10 pass, 32 assertions. Both package bun typecheck commands pass. Diagnostic checked on disposable invalid-executable fixtures: matching hashes, native Win32 error 216, duplicate counts, no key export or settings mutation. No real CLI/app/server started, full build, installer or restart.
- Direct oxlint: zero errors, one pre-existing no-service-constructor-imports warning at windows/index.ts makeWindowRecovery import. Changed-file lint remains blocked by that existing warning; no unrelated recovery-layer rewrite included.

### Corporate executable location restriction (2026-10-23)
- User clarified that Windows permits executable launches only below C:\Entwicklung. This makes the previous AppData staging incompatible with the stated execution policy; actual endpoint policy logs were not supplied.
- Windows CLI staging now uses C:\Entwicklung\<desktop-profile-name>\cli\<version-arch-build>, keeping prod/dev separate and rebuild hashes intact. Other platforms keep the existing user-data staging location. The early sidecar probe only discovers registrations and never launches a separate copy. Existing AppData settings, sessions and cache files are not moved or deleted, and there is no fallback execution from AppData.
- Also corrected updater execution paths: Windows installer downloads default to C:\Entwicklung\ai.opencode.desktop\updates; disallowed configured paths or paths inside the replaceable OpenCode installation fall back there instead of electron-updater's AppData cache. Allowed custom paths below C:\Entwicklung remain supported. Update helpers are copied to a unique directory below that cache rather than Windows Temp, outside the installation they clean.
- Diagnostic script now searches the allowed CLI root and refuses -ProbeCli execution outside C:\Entwicklung. Verified refusal using disposable Temp fixtures; no real application/server/CLI launched.
- CLI staging tests: 6 pass, 1 non-Windows skip, 16 assertions; updater cache tests: 9 pass, 12 assertions. Desktop and GUI-extension bun typecheck pass. lint:changed HEAD passes with zero problems, and direct touched-test oxlint has zero warnings/errors. No full build, installer, server restart or deployment; a new installer is still needed to deliver the fix.

### Full upstream integration (2026-10-29)

- Merged anomalyco/dev at 055a2a9c13 (v2.2.2), rather than selectively backporting features. Includes /goal with pause/resume/clear, current chat bubbles, session orchestration, SDK and GUI plugin architecture changes. Pre-merge corporate head: 649f63e88f.
- Retained AI Factory discovery, visibility/worker separation, managed config, proxy bypass and Exa/proxy support, MCP authentication/OAuth/reload protections, document/vision workers, encoding-preserving edits, updater/changelog, window recovery, and the C:/Entwicklung executable-location restriction. Adapted custom code to Effect 4.0.6, Bun 1.4.4, the new GUI plugin SDK, and renamed build/story paths. Regenerated the public Client from the merged schemas.
- Adapted the local Windows wrapper and signing hook to the new release pipeline. Corporate ZIP metadata can now be derived from final signed Windows installer bytes; SHA-512, changelog and legacy explicit-metadata mode are covered by disposable-fixture tests. No real build, signing, installer, application/service restart, Docker operation, or shutdown was performed.
- Typechecks pass in Core, Schema, Protocol, Server, Client, CLI, TUI, App, Desktop, GUI Plugins, Plugin SDK and Session UI. Goal/runner: 262 pass; core corporate regression suite: 338 pass, 1 platform skip; app/MCP/composer/catalog: 46 pass; updater: 52 pass; timeline/message projection: 26 pass; document/prompt/websearch: 58 pass; Windows staging/signing fixtures/registry/configuration and updater ZIP regressions also pass after restoring previewCompressionFpm.
- lint:changed anomalyco/dev passes with zero problems across all 82 corporate GUI files. The full comparison to pre-merge HEAD initially reported 760 diagnostics: one spacing issue in the corporate ZIP script was fixed; the other 759 are in 79 files unchanged from upstream. These upstream diagnostics remain, and the full upstream lint is not claimed green. SDK documentation validation passes (253 declarations, 928 members, 280 parameters; 11 source examples). All 38 package manifests, release workflow YAML and the PowerShell wrapper parse successfully. Frozen-lockfile install passes. Removed four obsolete dependency patches after checking the new dependency graph (gcp-metadata 8.1.4 already handles expected aggregate network failures).
- Production Timeline.resolveContent microbenchmark, 1000 tool parts / 10000 tail lookups / 7 samples: pre-merge median 55.82 ms; final isolated median 46.73 ms. The production function body is unchanged. A concurrent run measured 74.25 ms; results are sensitive to system load and do not establish browser rendering/scroll performance. No new GUI build or visual acceptance run was performed.
- Existing v2.1.2 tag and real settings/session databases/service registrations/windows remain untouched. The unrelated untracked infra/opencode-updater/admin-ui/.angular directory is excluded.

### Updater-managed optional Plugin Store (2026-10-29)

- Added the admin Plugin Store tab for optional registry package/version declarations, descriptions and visibility, plus public GET /opencode/plugin-store.json and admin list/PUT/DELETE endpoints. Entries persist in the dedicated UpdaterPluginStore table in the existing /app/data/feedback.db volume. Existing Compose mounts remain sufficient. Hidden and deleted offers do not uninstall packages. Local paths and arbitrary URLs are rejected.
- Added Plugin.Catalog/StoreItem/Package wire schemas and the location-aware plugin.catalog API; regenerated the current Client from Protocol. Catalog requests reuse trusted corporate updater settings, AI Factory credentials and HttpProxy. The response excludes plugin options and credentials. Failed feeds return available=false alongside global declarations so local removal remains possible.
- Extensions -> Plugins now includes search, refresh, explicit installation/version application and global removal. Installed packages omitted from the feed remain removable. The UI confirms configuration changes when agent actions are active, and uses the existing configuration reload/plugin.updated mechanism rather than restarting the service. Existing per-plugin failure reporting/repair remains in place.
- Atomic global config patches reconcile registry identities across versions without dropping other packages, options or ordered selectors. Native array changes preserve JSONC comments and package activation positions; legacy declarations migrate on write. Malformed global configuration is rejected without modification. Project and managed declarations are never removed by a global uninstall.
- Validation: updater dotnet build --no-restore succeeded with zero warnings/errors; real HTTP + SQLite integration test passed (31 assertions), including hidden/public separation, validation, version updates, deletion and restoration. Angular templates passed ngc --noEmit. Core config/catalog/MCP tests: 67 pass, 1 pre-existing platform skip, 238 assertions. Typechecks pass in Core, Schema, Protocol, Server, Client, App and Desktop. Changed-file GUI lint passes with zero problems across all three touched GUI files. Registry catalog authentication, unavailable-feed behavior, absence of credential leakage, first install, concurrent edits, upgrade order/options/comments, duplicate versions and refusal to overwrite malformed JSONC are covered. Corrected an older credential test fixture to respect the requested integration rather than returning a foreign credential for AI Factory.
- Documented the feature and added release notes. No Desktop/CLI build, installer, Docker rebuild, live app/service restart, real global config modification or deployment was performed; unrelated admin-ui/.angular files remain excluded.

### Post-merge corporate preservation and colleague update audit (2026-10-29)

Audited HEAD 5a41e970da against the pre-merge corporate head 649f63e88f. No functional regression or missing corporate fix was found in the inspected paths. This is a source and regression-test audit, not a new installer acceptance test on a colleague workstation.

- The colleague execution-policy fix remains active: packaged DesktopCli.resolveBundled calls stageCli with cliStageRoot; Windows resolves to C:/Entwicklung/<desktop-profile>/cli/<version-architecture-build-hash>, never the earlier AppData CLI staging. Build identity and channel separation remain. The early sidecar probe discovers registrations without launching another executable.
- Update downloads use C:/Entwicklung/ai.opencode.desktop/updates by default; invalid/outside paths and the replaceable installation subtree are rejected. A unique copy of OpenCode.UpdaterHelper.exe is launched under that allowed cache, outside C:/Entwicklung/OpenCode. The helper implementation and project are unchanged from 649f63e88f. It waits for the parent to exit, retries cleanup of the fixed install directory, then hands the downloaded installer the fixed destination. The NSIS customInit and customInstallMode still enforce the corporate destination. New upstream pre-extraction runs the downloaded installer with --stage only and has a normal-install fallback.
- Retained the explicit ElectronHttpExecutor for a custom AppAdapter (the former null request failure), corporate version comparison/feed authentication, changelog endpoint/UI, changelog.md output copy, Windows sharing-violation signing retries and diagnostic output, helper resource/build wiring, startup diagnostics, service-registration rename retries, and persisted-window deduplication/reuse. No production executable, installer or helper was run during this audit.
- Corporate behavior checks cover AI Factory visibility/pricing/reasoning/document workers including hidden models, native/direct document routing and local extraction, summary model output limits, Windows-1252/CRLF preservation, Exa and web/MCP proxy routing with internal AI Factory bypass, managed settings precedence, MCP OAuth/header behavior, and live MCP catalog changes. The provider allowlist/order, full numeric prompt date, ribbon hover code, plugin isolation/repair and new optional Plugin Store remain present in source. No new GUI visual acceptance test is claimed.
- Updater API integration tests confirm persistent promotions, all three config stages and promotion buttons/backend semantics, deprecated feedback handling, tester search, MCP Store OAuth and Plugin Store CRUD/visibility. Existing data-volume compatibility remains.
- Fresh results: Core 397 pass/1 platform skip (1300 assertions); Desktop packaging/signing fixtures, CLI stages, service state, window registry/state and migration 58 pass/1 platform skip (306 assertions); updater cache/version/changelog/state 52 pass (117 assertions); App MCP/composer/routes/catalog 46 pass (94 assertions); real isolated updater HTTP/SQLite tests 3 pass (125 assertions). Total 556 successful tests, 2 platform skips, 0 failures, 1942 assertions. The Windows installer execution tests and real Electron GUI/installer acceptance were not run.
- No application build, packaging, live service/app restart, Docker rebuild, deployment, tag movement or real settings/session/cache migration was performed. A fresh built and deployed installer is still required to deliver the merged source to colleagues.

### Windows installer CLI command registration (2026-10-29)

- Confirmed a gap outside the prior updater/startup audit: the Windows installer bundled resources/opencode-cli.exe but had no CLI command/PATH registration; DesktopCli.install supports macOS only.
- NSIS customInstall now creates C:/Entwicklung/OpenCode/bin/opencode.exe as a hard link to the bundled signed console binary (copy fallback), and registers only that bin directory in the current user PATH. This keeps the command separate from the GUI OpenCode.exe and requires neither Node.js nor a shell wrapper. Existing native CLI resources remain the source for Desktop staging/build identity.
- Bundled Windows PowerShell scripts update HKCU Environment using the original registry string kind and DoNotExpandEnvironmentNames, preserving unrelated paths, expandable references and Unicode without NSIS/setx truncation. Installation moves/deduplicates only its own bin entry to the front of the user PATH; oversized updates fail before writing. The machine PATH is untouched. WM_SETTINGCHANGE notifies the shell; fresh terminals inherit the updated environment. Updates keep the entry; customUnInstall removes it on actual uninstall while the scripts are still present.
- Packaging tests use the real electron-builder matcher to prove the scripts and their parent directory are included on Windows; non-Windows packaging remains unchanged. Added Windows PowerShell 5 tests for 11 transformation cases (empty/absent paths, Unicode/macros, idempotence, old GUI entries, duplicates, long paths, scoped removal and length refusal), plus compile-only coverage of the actual NSIS install/uninstall hooks. No compiled installer was executed and no real PATH or registry value was changed.
- Validation: final targeted suite 12 pass/220 assertions; broader CLI staging/version suite 28 pass, 1 non-Windows platform skip (246 assertions before the final parent-directory packaging assertion). Desktop bun typecheck passes, changed-file lint has zero problems across all three touched TS files, and both PowerShell scripts parse. No full build, packaging, live app/service restart or deployment. A fresh installer and a newly opened terminal are required to deliver/use the change.

### Windows packaging entry point and oversized archive (2026-10-29)

- Read-only inspection of the supplied dist/win-unpacked/resources/app.asar found 3,299,619,485 bytes. Previous dist-v2.1.2-ai-signed and dist-v2.1.2-local-signed releases account for 2,581,514,949 packed bytes, plus an unnecessary 296,098,816-byte resources/opencode-cli.exe copy. No payload was extracted or executed and existing release artifacts were preserved.
- The actual builder-effective-config.yaml had output dist, empty files and only the version override. package:win omitted --config; electron-builder did not automatically discover electron-builder.config.ts. Thus corporate archive filters, names/icons, installer hooks, extra resources and the output environment setting were bypassed. Earlier tests of getConfig() alone did not cover this entry point.
- package:win now explicitly selects the configuration; package.json also extends it for default/direct builder calls with metadata overrides. The Windows wrapper resolves output once before builds, passes that exact absolute directory through the environment and copies changelog.md there only after confirming the configured installer exists. Caller environment settings are restored in finally.
- New tests load configuration through real electron-builder argument normalization and Packager.validateConfig(), then verify real FileMatcher behavior. Disposable PowerShell wrapper fixtures cover relative/absolute/default output, spaces/brackets, environment restoration and missing installer failure. They stub only external build commands; no application build or installer is executed.
- Validation: 18 packaging/configuration/release/CLI registration tests passed, 274 assertions; Desktop bun typecheck passed; changed-file lint has zero warnings/errors; git diff --check passed. No full build, signing, deployment or application/service restart. Actual archive size and build time after the fix remain unmeasured until the next authorized full build.

### Corporate OAuth and MCP proxy authentication (2026-10-29)

- User reports HTTP 407 for both Codex browser (legacy) and Sign in with ChatGPT, plus continuing HubSpot MCP proxy failures. Found both OAuth implementations using raw fetch for token exchange/refresh and legacy device polling, bypassing HttpProxy. ChatGPT JOSE remote signing-key discovery also bypassed the adapter. All now use HttpProxy.fetch, including the local legacy cancel request so the callback remains direct. JOSE supports this via its customFetch option: https://github.com/panva/jose/blob/main/docs/jwks/remote/variables/customFetch.md.
- Found Config.layer always supplying the anonymous corporate proxy when http_proxy was omitted, overriding authenticated HTTP(S)/ALL_PROXY environment settings. Explicit global settings now win, followed by environment proxies and then the existing corporate fallback; use_http_proxy:false and internal AI Factory/loopback bypass remain effective. Six real configuration-loading cases verify precedence and bypass without changing user configuration.
- Added isolated HTTPS CONNECT tests using real plugin OAuth registration/callbacks, credential storage and refresh, device-code exchange and JOSE verification. Remote names terminate only at loopback fixtures. The child trusts an additional fixture-only certificate with TLS verification enabled, uses fake credentials, and has a deliberately closed inherited proxy to prevent accidental external requests. No global fetch mocks or production test flags were introduced. Verified proxy credentials reach CONNECT but never the origin.
- Exercised actual MCP loggedFetch and configured OAuth metadata discovery across two HTTPS hosts, token exchange and redirects, with password credentials and username-only credentials. These cases already pass against the previous adapter: they do not establish the exact cause of the user's live HubSpot failure. The configuration precedence issue can affect MCP as well; the user network, proxy auth scheme and precise live error remain unverified.
- Regression check against pre-fix source: all three OpenAI login cases plus configuration precedence fail; both MCP HTTPS credential cases pass. Fixed targeted suite: Core 112 pass, 1 Windows permission skip, 507 assertions; Util 12 pass, 52 assertions. Core and Util bun typecheck passed; direct lint of all six touched TypeScript files has zero warnings/errors. No full build, real browser/account login, live service restart, deployment or production credentials/configuration changes.

### Updater container rebuild with Plugin Store (2026-10-29)

- Explicitly authorized by the user after the Plugin Store implementation. Rebuilt both updater backend and Angular/nginx admin images from this worktree. Recreated only the two services in the existing local opencode-updater Compose project; retained its original configuration bind mounts, data volume, ports and network. Other Docker projects were untouched.
- The previous backend returned HTTP 404 for both Plugin Store endpoints. After replacement, public /opencode/plugin-store.json and administrative /opencode/admin/plugin-store return HTTP 200; the latter also works through the admin UI nginx proxy. The actually served JavaScript contains the Plugin Store UI and route.
- Compared parsed release-status and MCP Store responses before/after: unchanged. appsettings.json and appsettings.beta.json SHA-256 hashes are unchanged. Retained the old image IDs under rollback tags and saved a local database backup after a clean stop; SQLite removed its empty WAL/SHM files during shutdown. Backup and Compose override remain ignored local artifacts, outside the push.
- A subsequent source audit passed 57 provider/document/composer/model/CLI tests, including real Word/Excel/PDF extraction, hidden-worker vision/OCR, configured summary budgets and an isolated AI Factory CLI tool roundtrip. The audit ran before deployment and made no source changes. No Desktop installer was built or installed during this updater deployment.

### Update transfer visibility and HTTP ranges (2026-10-30)

- User measurement: approximately 299,288 KB in six minutes, about 830 KB/s or 6.8 Mbit/s. This is an observed average, not an identified network bottleneck; no office-network throughput comparison was performed.
- Windows download events now reach the private GUI updater state with percentage, transferred/total bytes and bytes per second. The global indicator remains visible while checking/downloading; settings show the transfer details and an accessible progress bar, followed by verification and installer preparation. Unknown progress remains valid. English/German text uses existing download/update terminology, checked against Mozilla's German update guide and Microsoft's Download Center.
- Actual electron-updater transfers log start, throttled progress, a 30-second heartbeat, verification and failure; listener/timer cleanup is scoped to each attempt and late events cannot overwrite a completed state. Packaged console output can be enabled explicitly with --print-logs or OPENCODE_DESKTOP_CONSOLE=1. Normal file logging remains enabled.
- Found the updater server's manual file streaming always returning HTTP 200 and ignoring Range. ASP.NET file results now support single/suffix/open ranges, validators and HTTP 416. New clients request single ranges instead of multipart ranges, which this server does not implement. Existing older clients may still fall back to full downloads; neither this fix nor the measurement proves the cause of slow full downloads.
- Validation: GUI updater/native Electron/cache/feed suite 54 pass (128 assertions); isolated server release/config/tester/MCP/plugin integration 3 pass (141 assertions); real browser settings component 1 pass, exercising unknown progress, 25% transfer, verification, preparation and ready. Plugin, GUI Plugins, App and Desktop package typechecks pass. .NET build has zero warnings/errors; changed-file lint has zero diagnostics across 14 TypeScript files.
- The browser fixture imports actual updater modules at runtime to preserve TypeScript project boundaries. Its first run exposed that assigning undefined to a native progress value throws; the final implementation uses an ARIA progress bar with an omitted unknown value and the test covers that initial state.
- No full Desktop/CLI build, packaging, installer execution, production app/service restart, Docker rebuild or deployment was performed for these changes. A new Desktop build and updater-server deployment are required to deliver them; the already running 2.1.2 client is unchanged.

### Temporarily disable installer CLI registration (2026-10-30)

- User reports an installer abort after files appear in C:/Entwicklung/OpenCode, including a newly created bin directory, and explicitly requests disabling CLI registration. The registration hooks contain hard Abort paths for directory/copy failures and a nonzero Windows PowerShell PATH-script result. This is a plausible cause, not a confirmed diagnosis without the failing installer's details.
- OPENCODE_REGISTER_CLI now defaults to 0 in the actual NSIS include. Installation skips command creation and PATH registration; normal uninstallation skips its PATH hook as well. Defining it as 1 before inclusion restores both hooks. The bundled sidecar CLI, fixed corporate installation directory, sandbox permissions and staged-update behavior remain intact. Existing command files and PATH entries are not removed by this change.
- Extended the existing compile-only NSIS contract with default-disabled and opt-in cases. The default case replaces registration macros with compile-time errors, so any accidental lifecycle invocation fails the build. The opt-in case compiles the actual registration/removal code. Together with the existing pure Windows PowerShell PATH transformation test: 2 pass, 15 assertions. Changed-file lint: zero diagnostics.
- Updated Desktop README and the current release notes to reflect the pause. No full application build, packaging, installer execution, real registry/PATH mutation or deployment was performed. A newly built installer is required to test the user's failure with registration disabled.

### HubSpot proxy diagnosis after successful curl CONNECT (2026-10-30)

- The user supplied curl output from the affected corporate PC: explicit http://webgwooe.rbgooe.at:8080 returned HTTP/1.0 200 Connection Established, then HubSpot HTTP 401 with WWW-Authenticate: Bearer resource_metadata=https://mcp.hubspot.com/.well-known/oauth-protected-resource. This proves that specific curl invocation reached the resource server. It does not identify OpenCode's selected proxy or establish that all backend requests use identical routing/configuration.
- Read-only retrieval of HubSpot's public protected-resource and authorization-server metadata confirmed authorization_servers, issuer, authorization endpoint and token endpoint use mcp.hubspot.com. A second hostname is therefore not the default token endpoint in this metadata. No user session, API key or OAuth operation was used for those GETs.
- Added failure-log annotations for selected proxy origin, credential-presence boolean and backend runtime. URL origins omit userinfo; no credential values are added. Existing request origin/method and error details remain. This is diagnostic visibility, not a claim to have fixed the live corporate 407.
- Extended the existing real HTTPS CONNECT keeper with anonymous HTTP/1.0 success and an actual 401 Bearer challenge, plus deliberate proxy 407 rejection. The latter verifies the actual MCP warning contains sanitized routing metadata without proxy usernames/passwords. Core proxy/OAuth suite: 30 pass, 112 assertions. Core package typecheck and direct lint of all three touched TypeScript files pass with zero diagnostics.
- Next live comparison: explicitly configure the same verified proxy URL in opencode.json to remove environment-based proxy selection from the comparison. The app's live route and cause of its 407 remain unverified. No production configuration change, full Desktop/CLI build or deployment was performed. The new log annotations require a fresh CLI/Desktop build.
