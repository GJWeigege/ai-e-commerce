# 跨境电商多租户管理系统 V1.0

一期链路已打通：采集 → AI 选品复审 → 上架 → 销售/代采 → WB 中转 → 代发仓入出库。

## 启动（本地开发）

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm prisma:generate
pnpm db:setup
pnpm dev:api
pnpm dev:web
```

- 前端：http://localhost:8000
- 后端：http://localhost:3000/api/v1
- 超管：`admin` / `Admin@123456`
- 演示租户管理员：`demo_admin` / `Demo@123456`
- 演示操作员：`demo_op` / `Demo@123456`

本机 5432/6379 已被占用时，compose 映射为 **5433 / 6380**。超管需在顶栏选择工作租户。

采集走用户浏览器里的 Chrome 插件（复用 ozon.ru 登录态）。创建任务后请加载插件并开始轮询领取。

商品库「上架 / 下架」走 Wildberries Content API：上架会在所选店铺建卡并轮询 nmID，同一商品可上架到多个店铺；下架会把对应店铺卡片移入回收站。店铺由**超级管理员**在「店铺管理」里按租户开通并保存卖家后台「Access to API」生成的**内容**类 Token（请求头为 `Authorization: {token}`，不要加 Bearer）。租户管理员不能自行增改店铺，避免用一个额度换绑。操作员只能使用管理员分配的店铺。

## 生产部署

推荐：**境外单机（首选首尔）**，Docker Compose 跑 Postgres / Redis / API / Web。采集仍在运营电脑的 Chrome 插件。

### 1. 机器与域名

- 规格：2 核 4G，80GB 盘，Ubuntu 22.04
- 安全组只开 `22`、`80`、`443`（库与 Redis 不要对公网）
- 域名 A 记录指向服务器；`WEB_ORIGIN=https://你的域名`

上线前在机器上自检：

```bash
curl -o /dev/null -s -w "%{http_code} %{time_total}\n" https://content-api.wildberries.ru
curl -o /dev/null -s -w "%{http_code} %{time_total}\n" -I https://www.ozon.ru
```

### 2. 配置并启动

```bash
cp deploy/.env.prod.example .env.prod
# 编辑 .env.prod：POSTGRES_PASSWORD、JWT_SECRET、CREDENTIAL_ENCRYPTION_KEY、WEB_ORIGIN、LLM_*
# 首次可临时 RUN_SEED=true，启动成功后改回 false

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# 或：pnpm prod:up
```

默认 Web 映射到宿主机 **8080**。健康检查：`http://服务器IP:8080/healthz` 或 `https://你的域名/api/v1/health`。

### 3. HTTPS（宿主机 Nginx）

参考 `deploy/nginx/host-ssl.conf.example`，用 Let’s Encrypt 签证书后反代到 `127.0.0.1:8080`。  
`WEB_ORIGIN` 必须与浏览器地址一致（含 `https://`）。

### 4. Chrome 插件

1. Chrome → 扩展程序 → 开发者模式 → 加载 `apps/collector-extension`
2. 插件已允许 `https://*/*`，API 填：`https://你的域名/api/v1`
3. JWT：登录后台后从 Local Storage 取 `aiecom_token`
4. 租户管理员 / 操作员一般不用填租户；超管按界面提示填写工作租户
5. 本机先打开 ozon.ru 过验证码 → 保存 → 开始轮询

### 5. 常用命令

```bash
pnpm prod:logs          # 看日志
pnpm prod:down          # 停止
# 发版：拉代码后
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

CSV 上传落在 Docker 卷 `aiecom_uploads`。上架全局并发见 `WB_LISTING_CONCURRENCY`（默认 4，同店串行）。

相关文件：

| 文件 | 说明 |
|---|---|
| `docker-compose.prod.yml` | 生产编排 |
| `deploy/Dockerfile.api` / `Dockerfile.web` | 镜像构建 |
| `deploy/nginx/default.conf` | 容器内反代 `/api` |
| `deploy/nginx/host-ssl.conf.example` | 宿主机 HTTPS 样例 |
| `deploy/.env.prod.example` | 生产环境变量模板 |

## 界面验收

用 `admin` 先为演示租户开通店铺，再用 `demo_admin` 登录按菜单走通：

1. 店铺管理：超管选择归属租户后新建 Wildberries 店铺并保存内容类 Token；租户管理员在用户管理里给操作员分配店铺（店铺管理仅可查看）
2. 采集任务：品类 TOP 或真实 Ozon 链接，用 Chrome 插件轮询领取直到成功
3. 选品复审：批量通过
4. 商品库：选择店铺上架（成功后写入该店铺 nmID）；选择店铺下架会调用 WB 回收站接口
5. 订单中心：新建销售单（自动生成代采单），连续「推进代采」直到到达 WB 仓
6. 仓储履约：代发仓入库 → 出库并填写物流单号
7. 全链路追踪：用销售单号查询节点

Chrome 采集插件：浏览器加载解压目录 `apps/collector-extension`，粘贴登录后的 JWT 即可（租户从 Token 读取；超管再填工作租户）。然后开始轮询领任务。
