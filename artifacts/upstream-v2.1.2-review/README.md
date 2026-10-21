# Upstream-Prüfung v2.1.2

Stand: 21. Oktober 2026. Ergebnis: **Kein problemloser Gesamtmerge auf 2.1.2. Gezielte Übernahmen sind möglich.**

## Grundlage

- Prüfbranch: `feat/merge-upstream-v2.1.2`, separater Worktree.
- Ausgangsbranch: `feat/merge-upstream-dev-v18`; Basis: `7bf0d56aa0fe73246fd429c504bae0bd8afdbdfa` (einschließlich des während der Vorbereitung neu hinzugekommenen Session-Resume-Commits).
- Original-Upstream: Remote `anomalyco`, https://github.com/anomalyco/opencode. `origin` und `upstream` zeigen beide auf den PureFlow-OSS-Fork.
- Neuester numerischer Versionstag: `v2.1.2`, Commit `a517687fde98a7329ada3ae644a01a9fc6c4e99e`, vom 21. Oktober. Der GitHub-Endpunkt `releases/latest` liefert dagegen noch `v1.19.3` vom 16. Oktober; für 2.1.2 existiert zum Prüfzeitpunkt kein gleichnamiges GitHub-Release-Objekt. Deshalb werden beide Linien getrennt bewertet.
- Gemeinsame Basis mit 2.1.2: `ecbc6ccac85b3e8087b6445e584318419b9e2b34` vom 7. September.
- 313 lokale und 4.966 Upstream-Commits seit der gemeinsamen Basis; davon 4.960 Upstream-Commits ohne Merge-Commits.
- Ziel ist der feste Tag 2.1.2. Das separat aktualisierte `anomalyco/dev` enthält bereits weitere 26 Commits und wurde nicht als Merge-Ziel verwendet.
- Uncommittete Änderungen des ursprünglichen Checkouts sind **nicht Bestandteil der Prüfbasis**. Insbesondere Managed-Provider-, Kostenanzeige- und Updater-Arbeiten müssen bei einer späteren Übernahme zusätzlich abgeglichen werden. Am ursprünglichen Checkout wurde nichts geändert.

## Gesamtmerge

| Ziel | Konfliktbehaftete Pfade | Bewertung |
| --- | ---: | --- |
| v2.1.2 | 200 | Größere Migration mit gezielter Portierung eigener Anpassungen |
| v1.19.3 | 5 | Deutlich kleinerer Integrationsschritt; weiterhin bewusste Konfliktauflösung nötig |

2.1.2: 89 Konfliktpfade in `packages/app`, 60 in `packages/opencode`, 19 in `packages/desktop`, 15 in `packages/core`; weitere 17 in anderen Paketen und Root-Dateien. Git meldet 137 modify/delete-, 36 Inhalts- und 27 Dateiverschiebungskonflikte sowie einen zusätzlichen Konflikt wegen einer auf mehrere Ziele aufgeteilten Verzeichnisverschiebung. Die Meldungszahl ist daher nicht identisch mit der Pfadzahl.

Der Upstream-Diff seit der gemeinsamen Basis betrifft bei Standard-Differkennung 9.004 Dateien. Die automatisierte Rename-Erkennung erreicht bei diesem Diff ihr Limit; diese Diffstat ist keine exakte Anzahl fachlich unterschiedlicher Dateien. Die eigentliche Merge-Prüfung verwendet `merge.renameLimit=10000`.

Die Schwierigkeiten liegen wesentlich an der Architektur: Upstream löst `packages/opencode` weitgehend ab und baut `packages/llm` zu `packages/ai` um. Zusätzlich steigen Bun von 1.3.14 auf 1.4.2 und Effect von 4.0.0-beta.83 auf 4.0.1. Eigene Provider, Session-Orchestrierung, GUI-Erweiterungen und Desktop-Updater müssen im neuen System gezielt erhalten werden; Git-Konflikte allein bilden diese Arbeit nicht vollständig ab.

Die fünf Konfliktdateien für 1.19.3 sind `.gitignore`, `bun.lock`, `packages/opencode/script/build.ts`, `packages/opencode/src/provider/provider.ts` und `packages/opencode/src/provider/transform.ts`. Auch ein weitgehend sauberer 1.x-Merge enthält funktionale Entscheidungen, unter anderem das Ende des Session-Sharings und neue Upgrade-/Update-Regeln. Vor Übernahme mit dem eigenen Updater und Provider-Verhalten abgleichen.

## Neun gemeinsam anwendbare Kandidaten

Diese neun Patches wurden zusätzlich zu ihrer Einzelprüfung **in dieser Reihenfolge gemeinsam in einem separaten Git-Index angewendet**. Alle neun Anwendungen waren konfliktfrei: 16 Dateien, 309 Einfügungen, 23 Löschungen. Ihr Produktcode wurde gesichtet. Das ist eine Git-Anwendbarkeitsprüfung und keine Laufzeitfreigabe.

| Commit | Nutzen | Prüfung bei tatsächlicher Übernahme |
| --- | --- | --- |
| [d5154fb74e](https://github.com/anomalyco/opencode/commit/d5154fb74e) | Frontmatter wiederholt zuverlässig parsen | Verhindert durch den globalen gray-matter-Cache vergiftete YAML-Fallbacks; Regressionstest enthalten. |
| [39e1ce55bc](https://github.com/anomalyco/opencode/commit/39e1ce55bc) | Repository-Hosts validieren | Verwirft relative Pfadsegmente in durch Doppelpunkte getrennten Hostnamen; Regressionstests enthalten. |
| [b471c2b449](https://github.com/anomalyco/opencode/commit/b471c2b449) | MCP-Browserstart unter Windows/WSL | Erkennt Launcher-Fehler auch dann, wenn der Prozess vor dem Registrieren des Exit-Listeners beendet wurde; Test enthalten. |
| [e50d845451](https://github.com/anomalyco/opencode/commit/e50d845451) | WSL-Kommandos korrekt übergeben | Verwendet --exec und verhindert vorzeitige Shell-Expansion; Tests enthalten. |
| [41f70bfbb1](https://github.com/anomalyco/opencode/commit/41f70bfbb1) | Anhänge über HTTP nutzen | Fallback für Blob-IDs, wenn crypto.subtle in unsicheren Kontexten fehlt. Separater Browsertest vor Übernahme sinnvoll. |
| [4aca1be945](https://github.com/anomalyco/opencode/commit/4aca1be945) | Doppeltes Mounten der Web-App verhindern | Markiert das Root-Element vor asynchroner Initialisierung. Startup/HMR vor Übernahme prüfen. |
| [c5e58b38a8](https://github.com/anomalyco/opencode/commit/c5e58b38a8) | Shell-Kommandos sauber kopieren | Kopieraktion liefert nur den Befehl; Promptzeichen ist nicht auswählbar. Ändert bewusst das bisher mitkopierte Output-Verhalten; UI prüfen. |
| [ba341c6cac](https://github.com/anomalyco/opencode/commit/ba341c6cac) | Node-Auflösung von npm-Plugins reparieren | Löst den konkreten Dateieinstieg über createRequire auf; Tests enthalten, auch Node-Pfad prüfen. |
| [bd0dffd781](https://github.com/anomalyco/opencode/commit/bd0dffd781) | OpenAI-Streamfehler erhalten | Unterstützt verschachtelte Event-Fehler; Provider-Regressionstests enthalten. |

Vor einer tatsächlichen Übernahme Paket-Typechecks und die jeweils enthaltenen Regressionstests aus den Paketverzeichnissen ausführen. Frontend-Verhalten zusätzlich im Browser prüfen. Es wurden hier **keine Patches in den Branch übernommen, keine Runtime-Tests und keine Typechecks ausgeführt**; der Branch enthält ausschließlich diese Prüfung. Der gemeinsame Testindex liegt außerhalb des Worktrees. Die Ergebnisbaum-ID ist in `batch.json` dokumentiert; sie ist ein lokales Git-Objekt und kein dauerhaft veröffentlichter Commit.

## Weitere technisch anwendbare Patches

Aus 4.960 Nicht-Merge-Commits wurden 317 kleine `fix`-/`perf`-Commits ausgewählt: höchstens fünf Dateien und 350 geänderte Textzeilen, nur vorhandene Dateien oder neue Tests in vorhandenen Verzeichnissen und Bezug zu App/Desktop/UI/Core/LLM/OpenCode/Session-UI/Codemode. Neue Architekturpakete, größere Feature-Pakete und andere nicht passende Änderungen wurden nicht einzeln getestet. Die Auswahl ist deshalb keine vollständige Bewertung aller Upstream-Commits.

- 58 Commits lassen sich einzeln ohne Konflikt mit Änderungen anwenden.
- 8 weitere ergeben gegenüber der Prüfbasis keine Änderung.
- 251 der 317 Kandidaten kollidieren bei Einzelanwendung.

Die folgende Liste umfasst alle 58 nicht leeren, konfliktfreien Einzelprüfungen. Außer dem neunteiligen Paket oben sind diese Patches **nicht auf gemeinsame Anwendbarkeit oder semantische Abhängigkeiten geprüft**. Insbesondere ähnliche Copilot-Fixes nicht blind beide übernehmen; die Commits #54201 und #54207 bearbeiten dieselbe Problematik. Dependency-, Berechtigungs-, Provider- und Session-Fixes benötigen gesonderte Prüfung.

| Commit | Upstream-Beschreibung |
| --- | --- |
| [b2a3926e87](https://github.com/anomalyco/opencode/commit/b2a3926e87e35fc7f6308521c4418067cddd5d0e) | fix(core): accept interleaved Copilot reasoning_opaque values (#54207) |
| [9f282f8c2c](https://github.com/anomalyco/opencode/commit/9f282f8c2c3285c34b2be5a75921d588765c13fc) | fix(core): accept interleaved Copilot reasoning_opaque values (#54201) |
| [5e2df97a89](https://github.com/anomalyco/opencode/commit/5e2df97a8945faa59064682c1160aadaee1b8ded) | fix(provider): accept OpenAI ultrafast service tier (#53875) |
| [d5154fb74e](https://github.com/anomalyco/opencode/commit/d5154fb74ea65542624c3345bd5a243a2369922e) | fix(core): bypass gray-matter content cache when parsing frontmatter (#51245) |
| [629e7aaa31](https://github.com/anomalyco/opencode/commit/629e7aaa31ea7b9957cfd92ca285191392413983) | fix(session-ui): increase markdown bold weight (#52389) |
| [e9f8a210b9](https://github.com/anomalyco/opencode/commit/e9f8a210b9e2b1e13d375b84906069886eb3b767) | fix(opencode): add namespaced session identity headers (#52370) |
| [39e1ce55bc](https://github.com/anomalyco/opencode/commit/39e1ce55bccb4ab1761c1edee7a5bfbefe6c1a49) | fix(core): reject relative path segments in repository hosts (#51577) |
| [b471c2b449](https://github.com/anomalyco/opencode/commit/b471c2b4495747353af768fbf2e0790c9d820ce2) | fix(opencode): catch completed MCP browser launcher failures (#51538) |
| [9d531435b4](https://github.com/anomalyco/opencode/commit/9d531435b4138f0658abc4b80da1e47bd00ea6de) | fix(desktop): stop signing macOS DMGs (#50469) |
| [f5ce4f881e](https://github.com/anomalyco/opencode/commit/f5ce4f881e477c7b75421cea2d20939f0ddd71fb) | fix(core): break filesystem search import cycle (#50439) |
| [ba341c6cac](https://github.com/anomalyco/opencode/commit/ba341c6cac5ed1ef867ef127245a42b5e33d4946) | fix(core): resolve npm package entrypoint to a file under Node (#50413) |
| [c10134729d](https://github.com/anomalyco/opencode/commit/c10134729dd2ce00beb18604ec91f10319f59a78) | fix(opencode): hoist Bedrock tool images except Claude, Nova, and Llama 4 (#50272) |
| [e50d845451](https://github.com/anomalyco/opencode/commit/e50d845451afd5f584e6bf38300657e39bbaa25a) | fix(desktop): run WSL commands with --exec so inline scripts are not pre-expanded (#49902) |
| [a9a6fad0fa](https://github.com/anomalyco/opencode/commit/a9a6fad0fae42af99b9f4b1d4ff519a979f16c90) | fix(opencode): request summarized adaptive thinking (#48269) |
| [f4dd76913f](https://github.com/anomalyco/opencode/commit/f4dd76913f87187d0469467986a3ef118f98f62b) | fix(session-ui): simplify file search styling (#48063) |
| [ac1758c0e6](https://github.com/anomalyco/opencode/commit/ac1758c0e6b8e7368be133e87e8e27a5f60dec04) | fix: preserve Bedrock DeepSeek model ids (#34441) |
| [9c65a69937](https://github.com/anomalyco/opencode/commit/9c65a69937ee43197121deea45af512662ead9c9) | fix(core): support granular webfetch permissions (#46611) |
| [8889447f5a](https://github.com/anomalyco/opencode/commit/8889447f5a65a31205b13d4fa4ad1f0b55115f66) | fix(core): scope compaction Completed section to finished work (#47203) |
| [a35f96f427](https://github.com/anomalyco/opencode/commit/a35f96f427e93cdfbfa7882d0c5ff1de7402f8b5) | fix(core): preserve late opaque reasoning (#45694) |
| [d432823515](https://github.com/anomalyco/opencode/commit/d432823515c3df6f3869309a6ad386d12c5c844f) | fix(deps): upgrade diff to 8.0.4 (#45772) |
| [971681c567](https://github.com/anomalyco/opencode/commit/971681c56786ead182ff2f01de89f24143959353) | fix(image): degrade photon resizer load failure to typed error on workerd (#43894) |
| [9e50d76416](https://github.com/anomalyco/opencode/commit/9e50d76416730b4e5c87856787d29f0bf6a2ed70) | fix(codegen): write prettier-stable schema snapshot (#43985) |
| [0fda7d1b33](https://github.com/anomalyco/opencode/commit/0fda7d1b33bdfa4fe41aad7b700dcdcd16837901) | fix(session-ui): reduce tool error spacing (#44318) |
| [93e1f383dd](https://github.com/anomalyco/opencode/commit/93e1f383dd79683af4fc5ad139cea0516603c838) | fix(app): allow selecting diff text (#44140) |
| [4aca1be945](https://github.com/anomalyco/opencode/commit/4aca1be9453097f0014df4f0d1083a028e24906a) | fix(app): prevent duplicate web mounts (#44119) |
| [1430a460f1](https://github.com/anomalyco/opencode/commit/1430a460f168249caedd2cd6c98a1d573c753576) | fix(ui): smooth shimmer loop (#43144) |
| [6359623e24](https://github.com/anomalyco/opencode/commit/6359623e244a5e843aebf8027412bc83cbb6cc72) | fix(ui): align settled animated numbers (#42998) |
| [c5e58b38a8](https://github.com/anomalyco/opencode/commit/c5e58b38a80c3d3d65dc2da09657c80c2c5b16c0) | fix(app): omit shell prompts when copying commands (#42958) |
| [08dd3f51ed](https://github.com/anomalyco/opencode/commit/08dd3f51ed5cba6ead719177c0fc68f5f17efac4) | fix(app): space no git status (#42868) |
| [d9dfceddf8](https://github.com/anomalyco/opencode/commit/d9dfceddf82168d38ab8086577372184cb837c50) | fix(app): release virtualized timeline elements (#42825) |
| [30dfe5352c](https://github.com/anomalyco/opencode/commit/30dfe5352c0dd93b2a9c50ac9e898e2c94ec3292) | fix(app): show read tool filenames (#42740) |
| [d35c6f04ed](https://github.com/anomalyco/opencode/commit/d35c6f04edc5778cd720396ccb86e43cf1681b7f) | fix(ui): add keybind label padding (#42726) |
| [4d021b4660](https://github.com/anomalyco/opencode/commit/4d021b4660a000e10134017614658586a8863838) | fix(app): fade tab titles beneath close button (#42730) |
| [57b050e9fc](https://github.com/anomalyco/opencode/commit/57b050e9fc073ed76b745ce05ad67f074249a2cc) | fix(desktop): render v2 patch metadata (#42716) |
| [41f70bfbb1](https://github.com/anomalyco/opencode/commit/41f70bfbb1ffde70bc48b21aa5b953fd0f4f233a) | fix(app): generate blob ids without crypto.subtle in non-secure contexts (#42706) |
| [c4bea9d558](https://github.com/anomalyco/opencode/commit/c4bea9d558ffae1a090878f32bac591b05cddaf0) | fix(app): stabilize markdown worker startup (#41487) |
| [f1366d80c8](https://github.com/anomalyco/opencode/commit/f1366d80c805d6545339910d4a0dbe05388eb817) | fix(core): default #sqlite resolution to the node driver (#41834) |
| [3b0195e045](https://github.com/anomalyco/opencode/commit/3b0195e0455616c714006b781667a0a22c209d58) | fix(core): avoid eager directory snapshots (#40552) |
| [79c7e9446e](https://github.com/anomalyco/opencode/commit/79c7e9446ee1e8bed0aefff404163754addeb485) | fix(core): clarify custom question answers (#38919) |
| [f1f0f47ee2](https://github.com/anomalyco/opencode/commit/f1f0f47ee22ae2972a7acef1b5d6dbb7e0578d1e) | fix(core): migrate named agent colors (#38414) |
| [59ad593d9c](https://github.com/anomalyco/opencode/commit/59ad593d9c7502bffdbd4579cc11b5aaa6e59e72) | fix(core): reduce snapshot repository setup (#38162) |
| [023f76f6fc](https://github.com/anomalyco/opencode/commit/023f76f6fc5fea9e1ae8442d4c0e0bbb0e92f0e5) | fix(core): refresh model catalog every five minutes (#38142) |
| [27e1692848](https://github.com/anomalyco/opencode/commit/27e169284873d95b87e31dbf71c64600a968d414) | fix: rm used config |
| [ba1f3d3d32](https://github.com/anomalyco/opencode/commit/ba1f3d3d32690879fbed156d53570b8652e254ed) | perf(codemode): batch OpenAPI query parameters (#36978) |
| [5c5579e90c](https://github.com/anomalyco/opencode/commit/5c5579e90c127ea3a48dd75e5c5876ed8109da02) | fix(llm): reject unterminated provider streams (#36881) |
| [6e55ddd078](https://github.com/anomalyco/opencode/commit/6e55ddd078c38f0ede90716bb1555c3d8f72af25) | fix(config): load configs across git boundaries (#36568) |
| [c7ceccf869](https://github.com/anomalyco/opencode/commit/c7ceccf869e7121f2dbd3b8480917995d523ee42) | fix(core): skip fff for aggregate locations (#36437) |
| [aca3b7813d](https://github.com/anomalyco/opencode/commit/aca3b7813d3946efb728b8e7f90b836f6d9d3b4b) | fix(core): publish skill source updates |
| [0bb24a46c1](https://github.com/anomalyco/opencode/commit/0bb24a46c180dcb7e5573441e4234405edd15ad4) | fix(core): defer snapshot repository discovery (#36290) |
| [bd0dffd781](https://github.com/anomalyco/opencode/commit/bd0dffd7815b850389555ffe833bec1862af6717) | fix(llm): preserve nested OpenAI stream errors (#36130) |
| [df471872de](https://github.com/anomalyco/opencode/commit/df471872dee53233307cda0adea121a5b2597a1f) | fix(codemode): reject Promise.all immediately (#35604) |
| [754dd57177](https://github.com/anomalyco/opencode/commit/754dd57177105142ccc1b954aba60206c52beb9d) | fix(codemode): preserve async callback semantics (#35603) |
| [0e1c0414c2](https://github.com/anomalyco/opencode/commit/0e1c0414c2f375161bbd948d76367917cb4d5f74) | fix(codemode): align mutable JavaScript semantics (#35598) |
| [baacb2e776](https://github.com/anomalyco/opencode/commit/baacb2e7769cb849790ee435e048672e7e771448) | fix(core): tolerate invalid OTLP configuration |
| [44b182fe23](https://github.com/anomalyco/opencode/commit/44b182fe23f12bc802f02625cb5e485405c6b3e8) | fix(core): validate scalar newtypes (#35381) |
| [ae49b21376](https://github.com/anomalyco/opencode/commit/ae49b2137658464241dcac88ef35d06b0f77f142) | fix(core): save external permissions at project root |
| [c26f6f95f7](https://github.com/anomalyco/opencode/commit/c26f6f95f74e16b2e5a8780e275f096ce8404bfc) | fix(core): deny subagent tool for default subagents |
| [f928b5be07](https://github.com/anomalyco/opencode/commit/f928b5be07087e667c2fa479a82bbcb2b4949aae) | fix(core): sanitize registered tool names (#34512) |

## Auffällige Grenzen

- `81200db2a3` (PowerShell im Projektordner öffnen) benötigt `packages/desktop/src/main/files/index.ts`; dieser Dateipfad existiert hier noch nicht. Erst auf die eigene Desktop-Dateiöffnungslogik portieren.
- `c3bf8864b9` (erste Scrollbar-Messung über ResizeObserver) kollidiert mit `packages/ui/src/components/scroll-view.tsx`.
- `d9dfceddf8` (virtualisierte Timeline-Elemente freigeben) ist technisch konfliktfrei, verändert aber Session-/Timeline-Code. Vor Übernahme gemäß App-AGENTS eine Produktions-Benchmark-Baseline aufnehmen und danach vergleichen.
- Neue Session-/Location-/Provider-Funktionen nicht ungeprüft übernehmen: lokale SessionV2-, Prozesskoordinator- und dauerhafte Inbox-Invarianten sowie die vorgegebene Abhängigkeitsrichtung bleiben verbindlich.
- Bei späteren öffentlichen Protocol-/Server-HttpApi-Änderungen den Client in `packages/client` mit `bun run generate` erzeugen; generierte Dateien nicht direkt bearbeiten. Für das Legacy-SDK dessen Build-Script verwenden.

## Reproduktion und Rohdaten

Gesamtmerge ohne Änderung am Worktree:

```powershell
git -c merge.renameLimit=10000 merge-tree --write-tree --name-only 7bf0d56aa0 v2.1.2
git -c merge.renameLimit=10000 merge-tree --write-tree --name-only 7bf0d56aa0 v1.19.3
```

Einzelpatchprüfung als expliziter Dreiwege-Merge mit dem Parent des Kandidaten als Merge-Basis:

```powershell
git merge-tree --write-tree --name-only --merge-base=<candidate-parent> 7bf0d56aa0 <candidate>
```

- `v2.1.2-merge-tree.txt`, `v1.19.3-merge-tree.txt`: vollständige Merge-Meldungen einschließlich Konfliktpfaden.
- `candidates.json`: alle 317 Einzelprüfungen einschließlich Konflikten und Änderungsstatistik.
- `v1-candidates.json`: ergänzende Einzelprüfungen von 16 Fix-/Server-Commits der 1.x-Linie; keine vollständige Bewertung aller 204 dort fehlenden Commits.
- `batch.json`: Reihenfolge und Ergebnis der gemeinsamen Prüfung der neun Kandidaten.

Empfehlung: Zuerst die kleinen unabhängigen Fixes übernehmen und testen. Den Gesamtwechsel auf 2.1.2 als eigene Migration behandeln. Falls kurzfristig ein vollständigerer Upstream-Abgleich gewünscht ist, ist 1.19.3 die kleinere Alternative, jedoch mit den oben genannten funktionalen Entscheidungen.
