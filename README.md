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

WB 官方目录（颜色、性别、季节、品牌、类目）与租户/店铺无关，第一次从 WB 拉到后写入项目 `config/wb-catalog`，之后所有租户、店铺共用，默认 14 天刷新。品类多了以后：进程内是 LRU（默认约 600 条 / 48MB），类目检索按商品名散落所以不落盘，单个类目品牌表截到 2500 条，店铺已配品牌则根本不拉品牌目录。可用 `WB_CATALOG_DIR`、`WB_CATALOG_TTL_DAYS`、`WB_CATALOG_MEMORY_MAX_ENTRIES`、`WB_CATALOG_MEMORY_MAX_MB` 覆盖。这不是业务数据，不按租户隔离。

## 生产部署

推荐：**境外单机（首选首尔）**，Docker Compose 跑 Postgres / Redis / API / Web。采集仍在运营电脑的 Chrome 插件。

生产编排一律用 **Compose v2**（`docker compose`，中间是空格）。Ubuntu 自带的 `/usr/bin/docker-compose`（1.29.2）和新版 Docker Engine 不兼容，recreate 时会报 `KeyError: 'ContainerConfig'`，不要用。

### 1. 机器与域名

- 规格：2 核 4G，80GB 盘，Ubuntu 22.04
- 安全组只开 `22`、`80`、`443`（库、Redis、以及容器映射的 **8080 都不要对公网**）
- 浏览器走宿主机 Nginx 的 80/443，反代到本机 `127.0.0.1:8080`
- 有域名：A 记录指向服务器，`WEB_ORIGIN=https://你的域名`
- 暂无域名、用 IP：`WEB_ORIGIN=http://服务器IP`（不要带 `:8080`）

上线前在机器上自检：

```bash
curl -o /dev/null -s -w "%{http_code} %{time_total}\n" https://content-api.wildberries.ru
curl -o /dev/null -s -w "%{http_code} %{time_total}\n" -I https://www.ozon.ru
```

### 2. 安装 Compose v2

Ubuntu 默认源 **没有** `docker-compose-plugin`（那是 Docker 官方源的包）。不要为此更换已有的 `docker.io` 引擎，直接装官方二进制：

```bash
# x86_64；ARM 把文件名改成 docker-compose-linux-aarch64
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
sudo ln -sfn /usr/local/lib/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose
hash -r

docker compose version
docker-compose version
which docker-compose
# 版本须为 v2.x；which 应为 /usr/local/bin/docker-compose
```

若 `which docker-compose` 仍是 `/usr/bin/docker-compose`：

```bash
sudo mv /usr/bin/docker-compose /usr/bin/docker-compose.v1.bak
hash -r
```

### 3. 配置并启动

```bash
cp deploy/.env.prod.example .env.prod
# 编辑 .env.prod（见下方必改项）
cp .env.prod .env

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

`.env.prod` **必须改掉示例值**，否则 API 容器会退出码 1 反复重启（`Restarting (1)`），Web 也会因解析不到 `api` 起不来。

| 变量 | 要求 |
|---|---|
| `POSTGRES_PASSWORD` | 强密码；初始化过后不要改（已有数据卷不会重读此值） |
| `JWT_SECRET` | `openssl rand -base64 32`，至少 24 位，不能含 `change-me` |
| `CREDENTIAL_ENCRYPTION_KEY` | 再生成一把，与 JWT **不能相同**；写入真实店铺 Token 后禁止再换 |
| `WEB_ORIGIN` | 与浏览器地址完全一致（协议 + 主机，无尾斜杠） |
| `RUN_SEED` | 首次可临时 `true`，成功后改回 `false` 并 recreate `api` |

生成密钥：

```bash
openssl rand -base64 32
openssl rand -base64 32
```

容器 Web 映射到宿主机 **8080**（仅本机 Nginx 反代用）。健康检查：

```bash
curl -sS http://127.0.0.1:8080/healthz
# 配好宿主机 Nginx 后：curl -sS http://127.0.0.1/healthz
# 有域名：curl -sS https://你的域名/api/v1/health
```

公网不要访问 `:8080`。安全组未开 8080 时，外网 `curl http://IP:8080/` 会直接连不上。

### 4. 宿主机 Nginx（80 / 443）

先确认容器已在本机 8080 监听，再改宿主机站点。不要让 Ubuntu 默认欢迎页占着 80。

**仅 IP、先走 HTTP：**

```bash
sudo tee /etc/nginx/sites-available/aiecom.conf >/dev/null <<'EOF'
server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 6m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sfn /etc/nginx/sites-available/aiecom.conf /etc/nginx/sites-enabled/aiecom.conf
sudo nginx -t && sudo systemctl reload nginx
```

有域名后改用 `deploy/nginx/host-ssl.conf.example`，Let’s Encrypt 签证书，反代到 `127.0.0.1:8080`。  
`WEB_ORIGIN` 必须与浏览器地址一致；改了要 `--force-recreate api`。

### 5. Chrome 插件

1. Chrome → 扩展程序 → 开发者模式 → 加载 `apps/collector-extension`
2. 插件已允许 `https://*/*`，API 填：`https://你的域名/api/v1`（或 `http://服务器IP/api/v1`）
3. JWT：登录后台后从 Local Storage 取 `aiecom_token`
4. 租户管理员 / 操作员一般不用填租户；超管按界面提示填写工作租户
5. 本机先打开 ozon.ru 过验证码 → 保存 → 开始轮询

### 6. 修改代码后发版

生产镜像把 API / Web 打进去，**拉代码不会自动生效**，必须在服务器重建容器。采集插件不进 Docker，要在运营电脑单独更新。

#### 发版前（本机）

- 改了 `prisma/schema.prisma`：必须 `pnpm prisma:migrate` 生成 migration 并提交。禁止只改 schema 不提交 migration，也禁止在生产手写 SQL 改表。容器启动会自动 `prisma migrate deploy`。
- 改了依赖：提交 `pnpm-lock.yaml`（镜像 `--frozen-lockfile`，缺 lock 会构建失败）。
- 新增环境变量：同步改 `deploy/.env.prod.example`，并在服务器 `.env.prod`（及 `.env`）填值后再重建。
- 改了 Chrome 插件：递增 `apps/collector-extension/manifest.json` 的 `version`。

#### 服务器（只重建 API / 前端）

Postgres / Redis 数据在命名卷里，**不要**对它们 `--force-recreate`，**不要** `down -v`。

```bash
git pull
cp .env.prod .env

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build api web
```

`--build` 只打 `api` / `web` 镜像。库容器保持不动。

只改了环境变量、没改代码时：

```bash
cp .env.prod .env
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate api web
```

`RUN_SEED` 保持 `false`。不要改已在用的 `CREDENTIAL_ENCRYPTION_KEY`（改了现有店铺 Token 无法解密）、不要轮换 `JWT_SECRET`（会让所有人掉线）。

#### 按改动类型

| 改了什么 | 服务器 | 运营电脑插件 |
|---|---|---|
| API / `packages/*` / Prisma | `git pull` + `up -d --build api web`（migrate 随 API 启动） | 一般不用动 |
| 仅 `apps/web` | 同上（会重建前端镜像） | 不用动 |
| 仅环境变量 / `deploy/.env.prod.example` | 改服务器 `.env.prod` 与 `.env`，`--force-recreate api web` | 若改了 API 地址再改插件里的 API |
| `apps/collector-extension` | 不用重建 Docker | 更新目录后在扩展页点刷新 |
| 宿主机 Nginx / 证书 | `nginx -t && systemctl reload nginx` | 不用动 |

一次改了多处就按上表把对应步骤都做完。

#### Chrome 插件（不随 Docker 发版）

插件是解压目录加载，改完后：

1. 运营电脑拿到新代码（`git pull` 或拷贝 `apps/collector-extension`）
2. Chrome → 扩展程序 → 开发者模式 → 该插件卡片点**刷新**
3. 打开插件弹窗确认 API 仍是 `https://你的域名/api/v1`（或当前线上 `http://IP/api/v1`），JWT 未过期
4. 本机已打开 ozon.ru 登录态后再「开始轮询」

只改了 `background.js` / `content.js` 也必须点刷新，否则仍跑旧脚本。解压加载的插件 ID 会变，默认已放行 `chrome-extension://` Origin。若要锁死商店包 ID，再把 `CHROME_EXTENSION_IDS` 写入服务器并 recreate API。

#### 发版后自检

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -sS http://127.0.0.1:8080/healthz
# 有宿主机 Nginx：curl -sS http://127.0.0.1/healthz
# 有域名：curl -sS https://你的域名/api/v1/health
docker compose -f docker-compose.prod.yml logs --tail=80 api
```

四个容器应为 `Up`（不是 `Restarting`），web 有 `8080->80`。日志里应看到 `prisma migrate deploy` 成功，然后 Nest 起来。浏览器强刷后台（避免旧前端缓存）。走一遍：登录 → 采集任务列表 →（若改了上架）商品库。

### 7. 排障

**`KeyError: 'ContainerConfig'`**  
仍在用 Compose v1（1.29.2）。按第 2 节换成 v2 后再发版。

**`Conflict. The container name "/xxxx_aiecom-..."` / `Recreating xxxx_aiecom-web`**  
上次 recreate 失败会留下 `{旧ID}_aiecom-*` 残留容器。只删容器、**不要** `-v`：

```bash
docker ps -a --filter name=aiecom --format 'table {{.ID}}\t{{.Names}}\t{{.Status}}'
docker volume ls | grep aiecom   # 确认 aiecom_pg_data 等还在

docker ps -aq --filter name=aiecom | xargs -r docker stop
docker ps -aq --filter name=aiecom | xargs -r docker rm    # 没有 -v

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres redis
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build api web
```

**`Restarting (1)` + `JWT_SECRET（至少 24 位，且不能使用示例值）`**  
`.env.prod` 仍是示例密钥。按第 3 节生成两把随机串，`cp .env.prod .env` 后 `--force-recreate api web`。

**`host not found in upstream "api"`**  
API 没起来，旧版容器内 Nginx 启动就会挂。先把 API 拉起来；当前仓库的 `deploy/nginx/default.conf` 已改为延迟解析，需 `--build web` 后才生效。

**公网打不开、本机 `127.0.0.1:8080` 却是 200**  
安全组没开 8080（按设计如此）。检查宿主机 Nginx 是否反代到 8080，浏览器走 `http://IP/` 或 `https://域名/`。若 80 仍是 `Welcome to nginx!`，说明还在用 Ubuntu 默认站点。

### 8. 常用命令

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f --tail=200
docker compose -f docker-compose.prod.yml --env-file .env.prod down    # 停止容器，不删卷
# 禁止：docker compose -f docker-compose.prod.yml down -v  （会清空库和上传文件）
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
