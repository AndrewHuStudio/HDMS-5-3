# HDMS 知识库 Docker 配置说明

## 技术栈

本配置包含完整的知识库系统组件：

- **PostgreSQL 15** - 关系型数据库（结构化数据存储）
- **MongoDB 7.0** - 文档数据库（非结构化数据存储）
- **Milvus 2.6** - 向量数据库（AI 语义检索、RAG）
- **Neo4j 5.13** - 图数据库（知识图谱、关系推理）
- **MinIO** - 对象存储（Milvus 依赖）
- **etcd** - 分布式协调服务（Milvus 依赖）

## 端口映射（与 MediArch 完全不同）

| 服务 | 容器内端口 | 主机端口 | MediArch 端口 | 说明 |
|------|-----------|---------|--------------|------|
| PostgreSQL | 5432 | **5434** | 5432 | 关系型数据库 |
| MongoDB | 27017 | **27019** | 27017 | 文档数据库 |
| Milvus | 19530 | **19532** | 19530 | 向量数据库 API |
| Milvus Metrics | 9091 | **9093** | 9091 | Milvus 监控指标 |
| Neo4j HTTP | 7474 | **7476** | 7474 | Neo4j 浏览器界面 |
| Neo4j Bolt | 7687 | **7689** | 7687 | Neo4j 数据库连接 |
| MinIO API | 9000 | **9004** | 9000 | 对象存储 API |
| MinIO Console | 9001 | **9005** | 9001 | MinIO 管理界面 |
| etcd | 2381 | **2381** | 2379 | 分布式协调 |

## 数据库连接信息

### PostgreSQL
```
Host: localhost
Port: 5434
Database: postgres
Username: postgres
Password: hdms_password_2024
```

### MongoDB
```
Host: localhost
Port: 27019
Database: hdms
Username: admin
Password: hdms2024
Connection String: mongodb://admin:hdms2024@localhost:27019/hdms?authSource=admin
```

### Milvus
```
Host: localhost
Port: 19532
```

### Neo4j
```
Browser: http://localhost:7476
Bolt: bolt://localhost:7689
Username: neo4j
Password: hdms2024
```

## 快速启动

### 1. 启动所有服务
```bash
cd e:\MyPrograms\HDMS
docker-compose up -d
```

### 2. 查看运行状态
```bash
docker-compose ps
```

### 3. 查看日志
```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f milvus
docker-compose logs -f postgres
```

### 4. 停止服务
```bash
# 停止但保留容器
docker-compose stop

# 停止并删除容器（数据保留在 E:/HDMS-Data）
docker-compose down
```

### 5. 重启服务
```bash
docker-compose restart
```

## 数据存储位置

所有数据存储在 `E:/HDMS-Data/` 目录下：

```
E:/HDMS-Data/
├── postgres/           # PostgreSQL 数据文件
├── mongodb/            # MongoDB 数据文件
├── mongodb_config/     # MongoDB 配置文件
├── milvus/             # Milvus 向量数据
├── neo4j/              # Neo4j 图数据库
├── neo4j_logs/         # Neo4j 日志
├── etcd/               # etcd 数据
└── minio/              # MinIO 对象存储
```

## 与 MediArch 项目共存

两个项目可以同时运行，通过以下方式隔离：

| 项目 | 容器名前缀 | 网络名称 | 数据目录 | PostgreSQL 端口 | MongoDB 端口 |
|------|-----------|---------|---------|----------------|--------------|
| MediArch | mediarch- | mediarch-network | E:/MediArch-Data | 5432 | 27017 |
| HDMS | hdms- | hdms-network | E:/HDMS-Data | 5434 | 27019 |

## 健康检查

### 检查 PostgreSQL
```bash
docker exec hdms-postgres pg_isready -U postgres
```

### 检查 MongoDB
```bash
docker exec hdms-mongodb mongosh --eval "db.adminCommand('ping')"
```

### 检查 Milvus
```bash
curl http://localhost:19531/healthz
```

### 检查 Neo4j
访问浏览器：http://localhost:7475

## 常见问题

### 1. 端口被占用
如果启动失败提示端口被占用，检查是否有其他服务使用了相同端口：
```bash
netstat -ano | findstr "5434"
netstat -ano | findstr "27019"
```

### 2. 数据持久化
即使运行 `docker-compose down` 删除容器，数据仍然保存在 `E:/HDMS-Data/` 中。
下次启动时会自动加载这些数据。

### 3. 完全清理（谨慎操作）
如果需要完全删除所有数据和容器：
```bash
docker-compose down -v
# 然后手动删除 E:/HDMS-Data/ 目录
```

### 4. 内存不足
如果系统内存不足，可以调整 Neo4j 的内存限制：
编辑 docker-compose.yml 中的 `NEO4J_server_memory_heap_max__size` 参数。

## 后续集成建议

### Python 连接示例

```python
# PostgreSQL
import psycopg2
conn = psycopg2.connect(
    host="localhost",
    port=5434,
    database="postgres",
    user="postgres",
    password="hdms_password_2024"
)

# MongoDB
from pymongo import MongoClient
client = MongoClient("mongodb://admin:hdms2024@localhost:27019/")
db = client.hdms

# Milvus
from pymilvus import connections
connections.connect("default", host="localhost", port="19532")

# Neo4j
from neo4j import GraphDatabase
driver = GraphDatabase.driver(
    "bolt://localhost:7689",
    auth=("neo4j", "hdms2024")
)
```

## 更新日期
2026-01-29
