# Slow the compose healthchecks (project-standards#1096)

The `db` and `api` healthchecks in `compose.yaml` polled every 5 s. On the shared server the api check starts a Node.js process each time, and with about ten apps the burstable CPU stayed throttled (79.6% steal, load 17-21 on 2 vCPUs on 2026-11-23).

| File | Change |
|---|---|
| `compose.yaml` | `interval: 60s`, `retries: 3`, `start_period` (30 s db, 60 s api) and `start_interval: 2s` (Docker Engine 25+, the server runs 29.1.3). `docker compose up -d --wait` still sees a ready container within about 2 s |
