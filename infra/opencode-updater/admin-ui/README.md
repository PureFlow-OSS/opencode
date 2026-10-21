# OpenCode Updater Admin UI

Angular 21 admin frontend for the updater server.

Planned screens:

- beta ZIP upload
- beta release promotion
- beta feedback audit trail
- general feedback inbox

This folder is intentionally isolated from the OpenCode app UI.

The nginx config in this folder proxies the updater server and allows request bodies up to 1 GB (`client_max_body_size 1g`) so desktop release ZIP uploads are not rejected before Kestrel receives them.
