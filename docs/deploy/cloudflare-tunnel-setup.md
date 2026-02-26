# HDMS 本地机对外开放（Cloudflare Tunnel）

下面步骤按 Windows + PowerShell 说明，适配你当前 802x 端口。

## 0) 前置条件
- 域名 `hdmsurban.com` 已购买。
- 你的域名需要托管在 Cloudflare（把域名 NS 改到 Cloudflare 提供的 nameserver）。
- 本机服务已经能本地访问（8021~8025）。

## 1) 安装 cloudflared
```powershell
winget install --id Cloudflare.cloudflared -e
cloudflared --version
```

## 2) 登录 Cloudflare
```powershell
cloudflared tunnel login
```
浏览器会弹出授权，选择你的 `hdmsurban.com` 对应 Zone。

## 3) 创建 Tunnel
```powershell
cloudflared tunnel create hdms-external
cloudflared tunnel list
```
执行后会生成一个 Tunnel UUID，并在 `%USERPROFILE%\\.cloudflared\\` 生成 `<UUID>.json`。

## 4) 配置本地 ingress 规则
1. 复制 `cloudflare/hdmsurban-tunnel.example.yml` 到：
   `%USERPROFILE%\\.cloudflared\\config.yml`
2. 把下面两处占位替换成你真实 UUID：
   - `tunnel: REPLACE_WITH_TUNNEL_UUID`
   - `credentials-file: ...REPLACE_WITH_TUNNEL_UUID.json`

## 5) 绑定域名到 Tunnel
```powershell
cloudflared tunnel route dns hdms-external hdmsurban.com
cloudflared tunnel route dns hdms-external www.hdmsurban.com
```

## 6) 验证规则
```powershell
cloudflared tunnel ingress validate
cloudflared tunnel ingress rule https://hdmsurban.com/qa/health
```

## 7) 启动你的本地服务（802x）
```powershell
# 外部测试数据库
cd e:\MyPrograms\HDMS
docker compose -f docker-compose.external.yml -p hdms_external up -d

# frontend
cd e:\MyPrograms\HDMS\frontend
npm run dev -- -p 8021

# qa_assistant
cd e:\MyPrograms\HDMS\backend\qa_assistant
python -m uvicorn app:app --reload --port 8022 --env-file ..\..\.env.external

# review_system
cd e:\MyPrograms\HDMS\backend\review_system
python -m uvicorn app:app --reload --port 8023 --env-file ..\..\.env.external

# approval_checklist (可选)
cd e:\MyPrograms\HDMS\backend\approval_checklist
python -m uvicorn app:app --reload --port 8024 --env-file ..\..\.env.external

# data_process
cd e:\MyPrograms\HDMS\data_process
python -m uvicorn main:app --reload --port 8025 --env-file ..\.env.external
```

## 8) 启动 Tunnel
```powershell
cloudflared tunnel run hdms-external
```

## 9) 外网验证
在手机 4G/5G（非同一局域网）验证：
- `https://hdmsurban.com`
- `https://hdmsurban.com/qa/health`
- 上传文件后确认输出写入 `data/ocr_output_external`

## 10) 常见问题
- 访问不到：先确认 DNS 已生效（`hdmsurban.com` 能解析到 Cloudflare）。
- 1016 错误：Tunnel 没连上，检查 `cloudflared tunnel run` 日志。
- 前端能开但接口 404：确认 `config.yml` 的 ingress 规则顺序未改乱。
