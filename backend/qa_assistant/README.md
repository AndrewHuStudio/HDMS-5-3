# QA Assistant Backend

This service hosts the QA chat API.

Run (external mode — matches the `hdms-external-*` database containers):
```bash
powershell -ExecutionPolicy Bypass -File ../../scripts/start-external.ps1 -Target qa
```

That serves port **8032** and loads `.env.external`. Starting with plain `.env`
points at the wrong database ports and the service cannot connect.

Port 8002 belongs to the separate *local* mode port set. See
[docs/ports-and-startup.md](../../docs/ports-and-startup.md) before mixing the two.
