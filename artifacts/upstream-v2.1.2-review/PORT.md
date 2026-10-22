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
