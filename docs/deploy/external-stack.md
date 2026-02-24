# HDMS External Stack (Isolated)

## What this gives you
- A second Docker stack for external users/testing.
- Separate containers, ports, networks, and volumes.
- Your existing local `hdms` data remains unchanged.

## Start external stack
```powershell
docker compose -f docker-compose.external.yml -p hdms_external up -d
```

## Check
```powershell
docker compose -f docker-compose.external.yml -p hdms_external ps
```

## Stop external stack
```powershell
docker compose -f docker-compose.external.yml -p hdms_external down
```

## Remove external data (DANGEROUS)
```powershell
docker compose -f docker-compose.external.yml -p hdms_external down -v
```

## App env for external run
Use `.env.external` when running your backend/data services so they connect to external DB ports:
- MongoDB: `37019`
- Milvus: `29532`
- Neo4j: `17689`

And file storage paths are isolated under `data_external/`.
