以下都是AI写的，我并不知道对不对嘻嘻。

# HGT Site（海龟汤站点）

这是清理后的最小可部署版本：Express + EJS + SQLite + Docker。代码和运行数据已分离，生产迁移只需要搬主库和上传文件。

## 目录结构

```text
src/                  后端源码
  app.js              应用入口：中间件、session、路由、启动服务
  config.js           环境变量统一入口
  db/                 SQLite 主库初始化、迁移、session 存储
  controllers/        页面/API 业务逻辑
  routes/             路由注册
  middlewares/        登录、权限、汤底查看记录
  utils/              通知、分享码、访问控制、时间工具
views/                EJS 页面模板
public/css/           页面样式
public/js/            前端交互脚本
public/uploads/       用户上传文件目录，运行时生成，不进 Git
scripts/              检查、迁移、修改管理员密码脚本
data/                 SQLite 数据目录，运行时生成，不进 Git
Dockerfile            Docker 镜像构建
compose.yaml          App + Caddy 部署
Caddyfile             HTTPS 反向代理配置
```

## 重要数据

必须备份和迁移：

- `data/hgt.sqlite3`：主业务库，包含用户、密码哈希、海龟汤、汤底、标签、留言、点赞、审核、公告、反馈、通知、分享码、房间数据。
- `public/uploads/` 或 Docker 宿主机的 `uploads/`：反馈图片、房间提示图、表情包。

可选迁移：

- `data/sessions.sqlite3`：登录态。清空后用户只是需要重新登录，不会丢账号或海龟汤。

## 环境变量

本地开发复制：

```powershell
copy .env.example .env
```

生产部署复制：

```bash
cp .env.production.example .env.production
```

上线前至少修改：

- `BASE_URL`：站点完整地址，例如 `https://soup.example.com`
- `DOMAIN`：Caddy 使用的域名，例如 `soup.example.com`
- `SESSION_SECRET`：至少 32 位随机字符串
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`：首次初始化管理员账号
- `CREATE_DEMO_DATA=0`：生产环境不要生成测试用户和测试汤
- `LLM_API_KEY`：需要 AI 主持人功能时再填写

## Windows 本地 npm 运行

要求：Node.js 24 LTS 或更新的受支持偶数版本。

```powershell
# 1. 解压项目并进入目录
cd hgt-site-clean

# 2. 安装依赖。不要复制旧项目的 node_modules。
npm ci

# 3. 准备本地环境变量
copy .env.example .env
notepad .env

# 4. 初始化/迁移数据库
npm run migrate

# 5. 启动
npm start
```

浏览器打开：

```text
http://localhost:3000
```

开发时热重载：

```powershell
npm run dev
```

修改管理员密码：

```powershell
npm run set-admin-password -- "新的强密码"
```

## Ubuntu 测试服务器 Docker 部署

```bash
# 1. 上传项目到服务器，例如 /opt/hgt-site
cd /opt/hgt-site

# 2. 准备生产配置
cp .env.production.example .env.production
nano .env.production

# 3. 建议先创建数据目录，便于确认挂载位置
mkdir -p data uploads/feedback uploads/room-hints uploads/stickers

# 4. 构建并启动
sudo docker compose up -d --build

# 5. 查看日志
sudo docker compose logs -f app
```

访问配置：

- 域名已解析到服务器：`.env.production` 里把 `DOMAIN` 改为域名，Caddy 会自动申请证书。
- 只想用 IP 测试：可以把 `DOMAIN=:80`，并把 `BASE_URL=http://服务器IP`、`COOKIE_SECURE=0`、`TRUST_PROXY=0`。

常用命令：

```bash
sudo docker compose ps
sudo docker compose restart app
sudo docker compose logs -f app
sudo docker compose down
```

## 从现有生产环境迁移到测试服务器

下面假设旧生产服务器项目目录是 `/opt/hgt-site-old`，新测试服务器目录是 `/opt/hgt-site`。

### 1. 旧生产服务器备份

```bash
cd /opt/hgt-site-old
mkdir -p backup
cp data/hgt.sqlite3 backup/hgt.sqlite3.$(date +%Y%m%d%H%M%S)
cp data/sessions.sqlite3 backup/sessions.sqlite3.$(date +%Y%m%d%H%M%S) 2>/dev/null || true
tar -czf backup/uploads.$(date +%Y%m%d%H%M%S).tar.gz uploads public/uploads 2>/dev/null || true
```

如果旧项目是 Docker 部署，数据库通常在宿主机的 `./data/hgt.sqlite3`；上传文件通常在宿主机的 `./uploads/`，因为 `compose.yaml` 把它挂到了容器 `/app/public/uploads`。

### 2. 传到测试服务器

```bash
# 在旧服务器执行，把文件传到新服务器
scp data/hgt.sqlite3 user@TEST_SERVER:/opt/hgt-site/data/hgt.sqlite3
scp -r uploads/* user@TEST_SERVER:/opt/hgt-site/uploads/ 2>/dev/null || true
scp -r public/uploads/* user@TEST_SERVER:/opt/hgt-site/uploads/ 2>/dev/null || true
```

`sessions.sqlite3` 可以不传；不传只会让测试环境里所有人重新登录。

### 3. 新测试服务器迁移并启动

```bash
cd /opt/hgt-site
cp .env.production.example .env.production
nano .env.production

# 测试环境建议先这样，避免误用正式域名和 HTTPS Cookie：
# BASE_URL=http://测试服务器IP
# DOMAIN=:80
# COOKIE_SECURE=0
# TRUST_PROXY=0
# CREATE_DEMO_DATA=0

sudo docker compose up -d --build
sudo docker compose exec app npm run migrate
sudo docker compose logs -f app
```

### 4. 校验迁移结果

```bash
sudo docker compose exec app node -e "const {initDatabase,getDb}=require('./src/db/database'); initDatabase(); const db=getDb(); console.log({users:db.prepare('select count(*) c from users').get().c, soups:db.prepare('select count(*) c from soups').get().c, comments:db.prepare('select count(*) c from comments').get().c});"
```

如果用户数、海龟汤数、留言数正常，就说明主库迁移成功。上传图片如果显示异常，优先检查 `uploads/` 是否复制到了新项目根目录。

