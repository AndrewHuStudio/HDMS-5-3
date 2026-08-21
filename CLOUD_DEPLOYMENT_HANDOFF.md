# HDMS 云端部署与后续开发交接

更新时间：2026-08-16（Asia/Shanghai）

## 先读这些

- 仓库规则：[AGENTS.md](AGENTS.md)。任何修改过的 Python/TypeScript/JavaScript/React 源码文件不得超过 600 行；修改前后运行 `./scripts/check-module-lines.ps1`。
- 本文只记录可安全共享的上下文；不得在本文、Git 提交或聊天里写入 API Key、密码、`.env.production` 内容或 SSH 私钥。
- 用户希望助手尽量直接执行已获授权的本地/云端操作，说明时给简短、可执行的步骤。

## 当前部署状态

HDMS 已部署至腾讯云 Ubuntu 服务器，代码目录为 `/opt/hdms`，运行完整 Docker Compose 架构：

- Nginx（唯一公网入口，80/443）
- Next.js frontend
- review、qa、data_process、approval
- PostgreSQL、MongoDB、Milvus、etcd、MinIO、Neo4j

所有数据库与对象存储端口均未暴露到公网。生产配置是仓库分支 `production-deploy` 的：

- `docker-compose.production.yml`
- `Dockerfile`
- `frontend/Dockerfile`
- `nginx/hdms.production.conf`
- `.env.production.example`
- `.dockerignore`

服务器真实环境文件为 `/opt/hdms/.env.production`（权限 600、未提交）。不要覆盖、删除或输出其内容。

## 数据迁移状态（已完成）

仅迁移 `hdms-external`，未迁移 `mediarch`。已验收的数据：

| 数据项 | 云端已验证结果 |
| --- | --- |
| 应用文件卷 `hdms_application_data` | 78 个上传/模型文件，339 个 OCR 文件 |
| MongoDB `hdms` | 13 个文档，798 个 chunks |
| Milvus `hdms_text_chunks` | 798 条向量 |
| Neo4j | 1214 节点，2674 条关系 |
| MinIO `a-bucket` | 4 个对象，约 8.9 MiB |

MongoDB 中 OCR 文件路径已从 Windows 路径改为 `/app/data/ocr/...`。迁移备份目录位于服务器 `/opt/hdms/.migration-backup-20260816-183714`，不要清除或覆盖数据卷。

数据服务内部健康检查均成功。公网数据页此前不能显示“数据库检查”的原因是 Nginx 未转发 `/health/db`；已在 `production-deploy` 提交 `6dad704 fix: proxy data service health endpoint` 添加该路由，并已将相同配置上传、校验、重载到服务器。服务器本机访问该接口返回正常数据统计。

## 域名与当前可用性

- 生产域名：`https://hdmsurban.com` 和 `https://www.hdmsurban.com`
- HTTPS 证书为 Let's Encrypt，自动续期已启用。
- 腾讯云防火墙已开放 22、80、443。

2026-08-16 域名 DNS 已从 Cloudflare 切换至腾讯云 DNSPod：权威 NS 显示 `mustang.dnspod.net` 与 `ginger.dnspod.net`，DNSPod 中 `@` 和 `www` A 记录均指向腾讯云服务器公网 IP。切换前 Cloudflare 返回过 530；若新对话时网页仍打不开，先检查 DNS 是否已在本地解析到服务器公网 IP，而非 Cloudflare IP，再检查服务器状态。服务器端当时正常：所有服务运行/健康，域名通过服务器本机可返回 200（根路径会跳转 `/uploads`）。

## 本地代码与分支

- 主工作目录：`E:\MyPrograms\HDMS`
- 生产隔离工作区：`E:\MyPrograms\HDMS\.worktrees\production-deploy`
- 生产分支：`production-deploy`
- 生产部署的最近相关提交：
  - `73a5bab feat: add production Docker deployment`
  - `32513b9 build: use Tencent PyPI mirror`
  - `9be2987 build: avoid apt dependency during Python image build`
  - `6dad704 fix: proxy data service health endpoint`

开始修复/开发时应在独立 worktree 或确认当前分支后进行，不要误改 Windows 本地开发 Compose。用户正在准备修复若干小问题；先让其给出具体页面、操作步骤、实际表现和期望表现，然后遵循系统化排错与测试流程。

## 正常发布流程

1. 在本地 `production-deploy` 工作区完成修改与验证；不要提交任何真实 `.env`、密钥或私钥。
2. 提交并推送：

   ```powershell
   git add <files>
   git commit -m "fix: ..."
   git push origin production-deploy
   ```

3. 云端更新和重建：

   ```bash
   cd /opt/hdms
   git pull origin production-deploy
   docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
   ```

服务器曾出现 GitHub 网络卡住的情况。若 `git pull`/`git fetch` 长时间无输出，不要盲目重复或覆盖服务器；先检查当前提交和工作树。紧急、仅配置变更时可先上传已验证的单个配置文件，再执行 `nginx -t` 和 `nginx -s reload`，之后再恢复 Git 同步。

不要执行 `docker compose down -v`，它会删除已迁移的数据卷。通常 `up -d --build` 不会清除数据。若只改 Nginx 配置，应先校验：

```bash
docker compose -f docker-compose.production.yml --env-file .env.production exec -T nginx nginx -t
docker compose -f docker-compose.production.yml --env-file .env.production exec -T nginx nginx -s reload
```

## SSH（敏感内容不写入）

远程用户为 `ubuntu`，项目路径 `/opt/hdms`。本机 SSH 配置有权限异常，历史上用 `ssh -F NUL -i <本地私钥路径> ubuntu@<服务器公网IP>` 成功连接。不要在回答中输出私钥内容、密码、完整 `.env.production` 或用户曾暴露过的第三方凭据；应建议轮换已暴露的 API Key。

## 快速只读诊断

```bash
cd /opt/hdms
docker compose -f docker-compose.production.yml --env-file .env.production ps
curl -sS -L -o /dev/null -w '%{http_code} %{url_effective}\n' https://hdmsurban.com/
docker compose -f docker-compose.production.yml --env-file .env.production exec -T data_process python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8004/health/db').read().decode())"
```

期望数据统计：Milvus 798、MongoDB 13/798、Neo4j 1214/2674。
