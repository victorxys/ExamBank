# ExamBank 自动构建与 Mac Mini 生产部署

代码合并或推送到 `main` 后，GitHub Actions 在 ARM64 托管机器构建 `examdb-backend`、`examdb-web`，推送阿里云 ACR。完成首次容器迁移并启用部署开关后，Mac Mini 上的专用 runner 拉取本次构建的镜像，备份数据库、执行增量迁移并更新应用。

这些文件负责镜像构建与后续更新。现有 launchd、宿主 PostgreSQL/Redis 部署需要先完成一次容器迁移，并配置本仓库的 runner 和 GitHub 凭据。以下涉及生产写入的命令供首次上线时执行，新增仓库配置本身不会切换生产服务。

## 1. GitHub 与镜像仓库

在 ACR 创建 `examdb-backend`、`examdb-web` 两个镜像仓库。Mac Mini 从公网地址拉取，不能使用仅阿里云 VPC 可达的 registry 地址。

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 配置：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `ACR_USERNAME` | ACR 登录用户名，可沿用 JKYun 的同一账号 |
| Secret | `ACR_PASSWORD` | ACR 登录密码；需要在本仓库单独填写，不能从另一仓库读取 |
| Variable | `ACR_REGISTRY_PUBLIC` | ACR 公网域名；不填时使用工作流中的 JKYun 同款默认值 |
| Variable | `ACR_NAMESPACE` | ACR 命名空间，默认 `victorxys` |
| Variable | `VITE_WECHAT_APP_ID` | 前端使用的公开微信 AppID；按现有生产配置填写 |
| Variable | `PRODUCTION_PATH` | 生产 Compose 目录，建议 `/Users/victor/services/examdb` |
| Variable | `PRODUCTION_DEPLOY_ENABLED` | 首次切换完成后填写 `true`，启用后续自动更新 |

两个应用镜像使用相同的 `build-运行编号-尝试次数-短提交号` 标签，并写入完整提交 SHA。部署使用本次构建的唯一标签，不以 `latest` 判断版本。前端 API 地址使用同源 `/api`，前端构建参数均为公开配置，不能放密钥。

先保持 `PRODUCTION_DEPLOY_ENABLED` 未设置或为 `false`，提交工作流后构建第一组镜像。GitHub Actions 的构建摘要会显示镜像版本；首次上线使用该版本。

## 2. 在 Mac 上注册专用 runner

使用运行 Docker Desktop 的 `victor` 用户，在 GitHub 仓库 **Settings → Actions → Runners → New self-hosted runner** 选择 **macOS / ARM64**，按页面提供的最新下载、校验和注册命令操作。注册目录应独立于生产 Compose 目录，例如 `/Users/victor/actions-runner-examdb`。

为 runner 增加自定义标签 `examdb-production`。最终应具有以下标签：

```text
self-hosted, macOS, ARM64, examdb-production
```

使用原生 macOS runner，Docker 命令连接这台机器已有的 Docker Desktop。当前工作流不会在生产 runner 上检出完整源码或执行镜像构建。

注册后按 runner 自带说明安装服务：

```bash
./svc.sh install
./svc.sh start
./svc.sh status
```

确认 GitHub 页面中 runner 为 `Idle`，该用户可执行 `/usr/local/bin/docker info` 和 `docker compose version`。首次手动初始化时，在同一用户会话中登录 ACR 以拉取私有镜像。后续工作流使用仓库 Secret 在临时 Docker 配置中登录，退出时删除临时配置，不依赖用户会话中的登录状态。密码通过交互提示或 `--password-stdin` 输入，不写进脚本、命令历史或仓库。

Docker Desktop 的登录自启与 macOS runner 服务都依赖实际用户会话。整机重启后无人登录时能否恢复服务，需要在维护窗口验证；不要为验证而直接重启当前生产机。

## 3. 准备首次容器迁移

生产配置与运行数据独立于 Git 工作目录，建议布局：

```text
/Users/victor/services/examdb/
├── compose.prod.yml
├── .env                  # Compose 参数、数据库和队列凭据
├── backend.env           # 继承现有应用密钥与外部服务配置
├── release.env           # 当前成功发布的镜像仓库与唯一版本
├── .production-ready     # 首次切换完成后才创建
├── backups/
└── data/
    ├── instance/
    ├── tts-audio/
    ├── signatures/
    ├── avatars/
    ├── tts-voices/
    └── tts-pt/
```

复制本次提交的 `deploy/compose.prod.yml` 到生产目录，参照 `deploy/.env.example`、`deploy/backend.env.example` 创建配置，限制配置文件权限。所有真实 `.env`、`release.env` 和备份都留在生产机。

必须继承原有 `SECRET_KEY`、`LLM_API_ENCRYPTION_KEY` 及相关外部服务凭据；尤其不能重新生成加密密钥替换旧值。容器中的 `localhost` 指向容器自身，宿主服务地址应使用 `host.docker.internal`；同 Compose 内的 PostgreSQL、Redis 使用服务名。数据库和 Redis 密码按模板要求生成，避免 URL 保留字符造成连接地址解析错误。

`.env` 中的 `APP_DATA_DIR` 指向上述 `data` 目录，`APP_UID=501`、`APP_GID=20` 对应当前 Mac 用户；如实际用户不同，先以 `id -u`、`id -g` 确认。保留 `LEGACY_PROJECT_ROOT=/Users/victor/development/ExamBank` 与 `LEGACY_DEVELOP_ROOT=/Users/victor/develop/examdb` 的兼容挂载，使两批历史记录中的绝对附件路径都指向复制后的同一份 `instance` 文件。此前只读检查发现较早目录的 12 个 PDF 文件均已存在于当前 `instance`，别名挂载可保留这些记录，无需改写业务数据。Compose 自动生成内部数据库及 Celery 连接地址；`POSTGRES_PASSWORD`、`REDIS_PASSWORD` 使用十六进制或仅字母数字的随机值。`backend.env` 按原始值加载，支持包含美元符号的既有密钥。

`backend.env` 每行必须是 `KEY=实际值`，不加外围引号。旧 dotenv 文件若写成 `KEY="实际值"`，迁入时需要去掉这一层引号；不要把带引号的旧文件直接复制为 raw 配置，也不要把注释放在实际值末尾。配置和备份目录仅供当前部署用户访问。

手工创建第一份 `release.env`，仓库地址不带标签：

```dotenv
BACKEND_IMAGE=你的公网ACR域名/你的命名空间/examdb-backend
WEB_IMAGE=你的公网ACR域名/你的命名空间/examdb-web
RELEASE_TAG=首次构建摘要中的build版本
```

后续命令在生产机的同一终端使用以下函数：

```bash
export PRODUCTION_PATH=/Users/victor/services/examdb
compose() {
  /usr/local/bin/docker compose \
    --project-name examdb-production \
    --project-directory "$PRODUCTION_PATH" \
    --env-file "$PRODUCTION_PATH/.env" \
    --env-file "$PRODUCTION_PATH/release.env" \
    -f "$PRODUCTION_PATH/compose.prod.yml" "$@"
}
compose config --quiet
compose pull
```

PostgreSQL、Redis 使用外部命名卷，首次由操作者明确创建：

```bash
docker volume create examdb-production-postgres
docker volume create examdb-production-redis
```

如果同名卷已存在，先确认其归属和内容。不要删除旧卷或另建空卷来绕过初始化检查。常规应用更新不会拉取或重建 PostgreSQL、Redis。

当前生产库约 206MB，业务文件约 5GiB。迁移期间保留旧数据与新副本；镜像、附件、备份及 Docker 磁盘镜像的增长都应计入容量。macOS 显示的约 75GB 可用空间包含可回收空间，不能把 APFS 的即时空闲值直接当作全部可用容量。

## 4. 首次切换：完整恢复旧库与附件

先安排短暂停写窗口，并在入口暂停业务请求。旧项目由 launchd 的 `KeepAlive` 管理，单独结束进程会被自动拉起；切换时需要卸载旧的三个服务：

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.exam_bank.celery_beat.plist"
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.exam_bank.celery_worker.plist"
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.exam_bank.gunicorn.plist"
```

停止前先等待后台任务结束，确认这些服务确已退出。旧宿主 PostgreSQL、Redis 和其他项目仍保留；此处不停止整机数据库服务。首次切换时还要禁用旧的登录自启，防止下一次登录又启动第二套业务任务：

```bash
launchctl disable "gui/$(id -u)/com.exam_bank.celery_beat"
launchctl disable "gui/$(id -u)/com.exam_bank.celery_worker"
launchctl disable "gui/$(id -u)/com.exam_bank.gunicorn"
```

如以后决定恢复旧部署，需先停止新容器业务服务，再用对应的 `launchctl enable`、`launchctl bootstrap` 恢复旧服务；同时核对切换后写入的数据。

使用 Postgres.app 的工具对真实生产库生成完整备份，凭据使用既有安全认证方式或交互输入：

```bash
umask 077
mkdir -p "$PRODUCTION_PATH/backups"
/Applications/Postgres.app/Contents/Versions/17/bin/pg_dump \
  --host localhost --username postgres --dbname ExamDB_prod \
  --format custom --file "$PRODUCTION_PATH/backups/initial.dump"
```

在旧应用已停止写入后，复制附件和生成资源：

```bash
mkdir -p "$PRODUCTION_PATH/data"/{instance,tts-audio,signatures,avatars,tts-voices,tts-pt}
rsync -a /Users/victor/development/ExamBank/instance/ "$PRODUCTION_PATH/data/instance/"
rsync -a /Users/victor/development/ExamBank/backend/static/tts_audio/ "$PRODUCTION_PATH/data/tts-audio/"
rsync -a /Users/victor/development/ExamBank/backend/static/signatures/ "$PRODUCTION_PATH/data/signatures/"
rsync -a /Users/victor/development/ExamBank/backend/data/avatars/ "$PRODUCTION_PATH/data/avatars/"
rsync -a /Users/victor/development/ExamBank/backend/static/tts_voices/ "$PRODUCTION_PATH/data/tts-voices/"
rsync -a /Users/victor/development/ExamBank/backend/static/tts_pt/ "$PRODUCTION_PATH/data/tts-pt/"
```

不要复制旧的 Redis 数据或 Beat 调度文件；旧队列的在途任务应在停机前完成。确认 `.env`、`backend.env`、`release.env` 仅部署用户可读写，且 `data` 内可写目录属于 `APP_UID`/`APP_GID` 对应用户。

启动新的数据库与队列，然后恢复完整备份：

```bash
compose up -d --wait postgres redis
compose exec -T postgres sh -c \
  'exec pg_restore --exit-on-error --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  < "$PRODUCTION_PATH/backups/initial.dump"
```

恢复目标必须是本次新建且未写入业务数据的数据库。当前迁移链以已有业务表为前提，不能在空库直接 `flask db upgrade`，也不能用 `db.create_all()` 或 `stamp head` 代替完整恢复。保留备份中的 `alembic_version`；此前只读查看的生产版本是 `c6d7e8f9a0b1`。

核对恢复版本、关键表记录与附件可读性后，使用新镜像执行必要的增量迁移并启动应用：

```bash
compose run --rm --no-deps api flask --app backend.app db upgrade
compose up -d --no-deps --wait api worker web
curl -fsS http://127.0.0.1:18081/api/health
```

确认旧 Beat 已退出，才启动新 Beat：

```bash
compose up -d --no-deps beat
```

容器前端仅绑定宿主 `127.0.0.1:18081`。将宿主 Nginx 的 ExamBank 前端、`/api`、`/media` 等对应路由转发到这个地址，保留现有企业微信回调 include、其他站点及隧道入口。当前 443 已被其他容器使用，不将新的应用容器绑定到该端口。

外层 Nginx 需保留入口的 `X-Forwarded-Proto`，避免将 HTTPS 请求覆盖成 HTTP。API 未映射宿主端口，只接受 Compose 内部 Web 代理流量，因此设置 `FORWARDED_ALLOW_IPS=*`，使 Gunicorn 正确识别该协议头，生成 HTTPS 的附件链接和 PDF 资源地址。若以后直接开放 API 端口，应重新限制信任的代理地址。

基础验收包括登录、业务查询、一个附件或媒体访问、PDF 导出、一个异步任务，以及检查健康接口的提交 SHA。切流成功且六个服务均已存在后，再创建初始化标记：

```bash
printf '%s\n' 'ExamBank 已完成首次容器迁移与入口切换' > "$PRODUCTION_PATH/.production-ready"
chmod 600 "$PRODUCTION_PATH/.production-ready"
```

最后将 GitHub 变量 `PRODUCTION_DEPLOY_ENABLED` 设置为 `true`。之后推送 `main` 或在 `main` 手动运行工作流，会执行自动更新。

## 5. 后续自动更新与失败处理

自动部署只接受成功构建的唯一版本，使用同次构建的部署产物并核对完整提交号。流程为：拉取并校验两个 ARM64 镜像 → 停 Beat、等待 Worker/API 退出 → 备份当前数据库到 `backups` → 新镜像执行数据库迁移 → 启动 API、Worker、Web 并检查健康和精确版本 → 启动 Beat → 保存成功发布的 `release.env`。

脚本要求生产目录已完成初始化、已有六个服务，不负责首次创建生产环境。它不覆盖应用密钥、不更新生产 Git 工作区，也不会执行 `docker compose down`、清理数据卷或清理镜像。

生产端每次发布使用仓库 Secret 登录 ACR，无需预先手动 `docker login`。工作流为该 registry 显式指定空 `credHelpers`，将凭据写入当前任务的临时目录，避免 Docker CLI 在后台自动调用 macOS 钥匙串而报 `User interaction is not allowed`；任务结束后删除该目录，不改全局 Docker 登录配置。登录和镜像拉取最多尝试三次；这些步骤完成前不会停止生产服务。

出现 `TLS handshake timeout` 时，应检查 Mac Docker 到 ACR 的连接，而非重复填写密码。使用 Clash Verge 时，注意 ACR 域名可能被过宽的关键词规则匹配；可在当前订阅的持久规则扩展 `prepend` 中，为准确的 registry 域名增加优先 `DIRECT` 规则，避免改动其他域名的代理策略。

部署失败时查看 GitHub Actions 日志和实际容器状态，保留数据库备份及现场。数据库迁移失败或新应用未健康时，Beat 保持停止，不自动在未知结构上恢复定时任务。不要仅为恢复旧镜像而自动回退数据库；需要恢复时应先确认新增写入、数据库迁移兼容性和备份时间。

日常只读查看：

```bash
compose ps
compose logs --tail=100 api worker beat
curl -fsS http://127.0.0.1:18081/api/health
```

发布前备份不替代日常备份。数据库、附件和加密密钥都应独立备份，并复制到其他设备或对象存储。GitHub Actions 不上传生产数据备份。

## 6. Navicat 通过 SSH 隧道连接数据库

Compose 将 PostgreSQL 映射到 Mac 的 `127.0.0.1:${POSTGRES_HOST_PORT:-15432}`。使用现有 SSH 公网入口建立隧道，无需另开公网数据库端口。

在 Navicat 新建 PostgreSQL 连接，**常规**页填写：

| 字段 | 值 |
| --- | --- |
| 主机 | `127.0.0.1` |
| 端口 | `15432`，或生产 `.env` 中的 `POSTGRES_HOST_PORT` |
| 数据库 | `ExamDB_prod`，或生产 `.env` 中的 `POSTGRES_DB` |
| 用户名 | `examdb`，或生产 `.env` 中的 `POSTGRES_USER` |
| 密码 | 生产 `.env` 中的 `POSTGRES_PASSWORD` |

在 **SSH** 页启用 SSH 隧道，填写实际的 SSH 公网域名、SSH 公网端口、登录用户，以及对应的私钥或 SSH 登录密码。这里使用已有的 SSH 入口，数据库密码与 SSH 认证分别填写。启用隧道后，常规页的 `127.0.0.1` 指向 SSH 登录的 Mac，连接的是其回环映射端口。

常规自动发布只更新应用服务，不重建 PostgreSQL。已有环境首次增加或修改 `POSTGRES_HOST_PORT` 时，需在维护窗口单独将 Compose 端口配置应用到 `postgres` 服务：暂停本项目 API、Worker、Beat，重建 PostgreSQL 容器并复用原有命名卷，待其健康后恢复应用。修改仓库配置或只执行应用发布不会自动改变正在运行的数据库端口。
