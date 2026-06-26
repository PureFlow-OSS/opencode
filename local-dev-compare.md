# local/dev Vergleich

Stand: aktueller Branch `feat/merge-upstream-dev`

## Ergebnis

Ich habe die aktuell sichtbaren Desktop-/App-/Tool-Pfade gegen `local/dev` abgeglichen. Dabei habe ich keine eindeutig fehlende Funktionalität gefunden, sondern vor allem Umbauten in der Verdrahtung.

## 1:1-Matrix

| local/dev | aktueller Pfad | Status |
| --- | --- | --- |
| `checkUpdate()` | `packages/desktop/src/renderer/index.tsx:203` -> `window.api.updater.check()`; `packages/desktop/src/main/updater.ts:68` -> `checkUpdate(controller)` | umbenannt |
| `updateAndRestart()` | `packages/desktop/src/renderer/index.tsx:210` -> `window.api.updater.install()`; `packages/desktop/src/main/updater.ts:78` -> `installUpdate(controller)` | umbenannt |
| `resetData()` | `packages/desktop/src/renderer/index.tsx:211` -> `window.api.resetData()`; `packages/desktop/src/main/updater.ts:85` -> `resetData()` | vorhanden |
| `getWslEnabled()` / `setWslEnabled()` | `packages/app/src/context/platform.tsx:94` -> `wslServers`; `packages/desktop/src/renderer/index.tsx:254` -> `wslServers: wslServersApi` | umgebaut |
| `openFilePickerDialog()` | `packages/desktop/src/renderer/index.tsx:140` -> `openAttachmentPickerDialog()` / `saveFilePickerDialog()` | umgebaut |
| Shell background jobs | `packages/opencode/src/tool/shell.ts:633` + `packages/opencode/src/tool/bash_read.ts` + `packages/opencode/src/tool/bash_stop.ts` | vorhanden |
| Proxy-aware `webfetch` | `packages/opencode/src/tool/webfetch.ts:1` | vorhanden |
| Proxy-aware `websearch` | `packages/opencode/src/tool/websearch.ts:1` | vorhanden |

## Nicht belegte Lücken

- zusätzliche lokale Update-Helper-Logik
- fehlender Shell-/Webfetch-/Websearch-Flow
- fehlende WSL-Funktionalität

## Hinweis

Das ist ein Funktionsvergleich, kein vollständiger Architekturvergleich. Die Desktop-Bridge ist deutlich neu aufgebaut, aber die betroffenen Funktionen sind weiter vorhanden oder auf neue APIs umgezogen.
