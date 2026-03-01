# HDMS Public Deploy Checklist (802x External Stack)

## 1) Keep data services local-only on host
`docker-compose.external.yml` now binds DB ports to `127.0.0.1`, so only local services can connect.

Start external data services:

```powershell
docker compose -f docker-compose.external.yml -p hdms_external up -d
```

## 2) Start application services with `.env.external`

```powershell
# frontend
cd frontend
npm run dev -- -p 8021

# qa
cd ..\backend\qa_assistant
python -m uvicorn app:app --reload --host 0.0.0.0 --port 8022 --env-file ..\..\.env.external

# review
cd ..\review_system
python -m uvicorn app:app --reload --host 0.0.0.0 --port 8023 --env-file ..\..\.env.external

# approval_checklist（推荐用 Docker 固定模板）
cd ..\..
docker compose -f docker-compose.external.yml -p hdms_external --profile approval up -d approval_checklist

# data process
cd ..\..\data_process
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8025 --env-file ..\.env.external
```

## 3) Configure Nginx for your domain
- Use `nginx/hdms-public-802x.conf`.
- Replace `YOUR_DOMAIN` with your real domain.
- Ensure certificate files exist:
  - `/etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem`
  - `/etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem`

Validate and reload:

```bash
nginx -t
systemctl reload nginx
```

## 4) DNS and firewall
- DNS A/AAAA record: `YOUR_DOMAIN` -> your server public IP.
- Open only `80` and `443` to the public.
- Do NOT expose DB ports (`15434`, `37019`, `29532`, `17689`) publicly.

## 5) Public env template
- Use `.env.external.public.example` as the template for internet-facing values.
- Especially update `CORS_ORIGINS` and `NEXT_PUBLIC_*`/`HDMS_*_BASE_URL` to your real domain.

## 6) Verify from another network
- `https://YOUR_DOMAIN`
- `https://YOUR_DOMAIN/qa/health`
- `https://YOUR_DOMAIN/approval/health`
- Upload a test file and verify output in `data/ocr_output_external`.
