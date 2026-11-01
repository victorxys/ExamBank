#!/usr/bin/env bash
# 由 Mac 原生 Runner 调用；只使用本次构建的产物和已初始化的生产目录。
set -euo pipefail
umask 077

fail() {
  echo "错误：$*" >&2
  exit 1
}

BUNDLE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
for name in PRODUCTION_PATH RELEASE_TAG GITHUB_SHA BACKEND_DEPLOY_IMAGE WEB_DEPLOY_IMAGE; do
  [ -n "${!name:-}" ] || fail "自动部署缺少配置 ${name}。"
done
DOCKER_BIN="${DOCKER_BIN:-/usr/local/bin/docker}"
PRODUCTION_COMPOSE_PROJECT="${PRODUCTION_COMPOSE_PROJECT:-examdb-production}"

[[ "$PRODUCTION_PATH" == /* && "$PRODUCTION_PATH" != / && "$PRODUCTION_PATH" != *$'\n'* && "$PRODUCTION_PATH" != *$'\r'* ]] ||
  fail 'PRODUCTION_PATH 必须是既有生产目录的绝对路径。'
[ -d "$PRODUCTION_PATH" ] || fail '生产目录不存在；自动部署不会创建或初始化生产环境。'
PRODUCTION_PATH="$(cd "$PRODUCTION_PATH" && pwd -P)"
[[ "$PRODUCTION_COMPOSE_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail 'Compose 项目名格式无效。'
[[ "$RELEASE_TAG" =~ ^build-[0-9]+-[0-9]+-[a-f0-9]{7}$ ]] || fail '版本必须是成功构建的唯一 build 标签。'
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ ]] || fail 'GITHUB_SHA 必须是完整提交 SHA。'
[ "${RELEASE_TAG##*-}" = "${GITHUB_SHA:0:7}" ] || fail '版本标签与提交 SHA 不一致。'
for image in "$BACKEND_DEPLOY_IMAGE" "$WEB_DEPLOY_IMAGE"; do
  [[ "$image" =~ ^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$ && "$image" == */* ]] || fail '镜像仓库地址格式无效。'
  [[ "${image##*/}" != *:* ]] || fail '镜像仓库配置不能自带标签。'
done
[ -x "$DOCKER_BIN" ] || fail '未找到 Docker CLI，请配置 PRODUCTION_DOCKER_BIN。'
[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || fail '生产发布必须在 Mac ARM64 原生 Runner 上运行。'
[ -s "$PRODUCTION_PATH/.production-ready" ] || fail '缺少非空 .production-ready；请先完成数据库恢复和首次初始化。'
[ -r "$PRODUCTION_PATH/.env" ] && [ -r "$PRODUCTION_PATH/backend.env" ] || fail '生产目录必须已有可读的 .env 和 backend.env。'
[ -r "$BUNDLE_ROOT/BUILD_REVISION" ] && [ "$(cat "$BUNDLE_ROOT/BUILD_REVISION")" = "$GITHUB_SHA" ] || fail '部署产物 BUILD_REVISION 不匹配。'
[ -f "$BUNDLE_ROOT/deploy/compose.prod.yml" ] || fail '部署产物缺少 Compose 文件。'

"$DOCKER_BIN" compose version
[ "$("$DOCKER_BIN" info --format '{{.OSType}}/{{.Architecture}}')" = linux/aarch64 ] ||
  [ "$("$DOCKER_BIN" info --format '{{.OSType}}/{{.Architecture}}')" = linux/arm64 ] ||
  fail 'Docker daemon 必须运行 Linux ARM64 容器。'

# 不 source 配置文件；Compose 负责安全解析插值，Shell 环境固定为本次发布。
export BACKEND_IMAGE="$BACKEND_DEPLOY_IMAGE"
export WEB_IMAGE="$WEB_DEPLOY_IMAGE"
export RELEASE_TAG
COMPOSE=("$DOCKER_BIN" compose --project-name "$PRODUCTION_COMPOSE_PROJECT" --project-directory "$PRODUCTION_PATH" --env-file "$PRODUCTION_PATH/.env")
if [ -e "$PRODUCTION_PATH/release.env" ]; then
  [ -r "$PRODUCTION_PATH/release.env" ] || fail 'release.env 不可读。'
  COMPOSE+=(--env-file "$PRODUCTION_PATH/release.env")
fi
COMPOSE+=(-f "$BUNDLE_ROOT/deploy/compose.prod.yml")
compose() { "${COMPOSE[@]}" "$@"; }
compose config --quiet

container_for() {
  local ids
  ids="$("$DOCKER_BIN" container ls --all \
    --filter "label=com.docker.compose.project=$PRODUCTION_COMPOSE_PROJECT" \
    --filter "label=com.docker.compose.service=$1" --format '{{.ID}}')"
  [ -n "$ids" ] && [[ "$ids" != *$'\n'* ]] || fail "既有服务 $1 必须恰好有一个容器；自动部署不会初始化空环境。"
  printf '%s\n' "$ids"
}

for service in postgres redis api web worker beat; do
  container_for "$service" >/dev/null
done
for service in postgres redis; do
  container_id="$(container_for "$service")"
  [ "$("$DOCKER_BIN" container inspect --format '{{.State.Status}}' "$container_id")" = running ] || fail "既有 $service 未运行。"
  if [ "$service" = postgres ]; then data_path=/var/lib/postgresql/data; else data_path=/data; fi
  data_mount="$("$DOCKER_BIN" container inspect --format "{{range .Mounts}}{{if eq .Destination \"$data_path\"}}{{.Type}}:{{.Name}}{{end}}{{end}}" "$container_id")"
  [ "$data_mount" = "volume:examdb-production-$service" ] || fail "$service 未挂载预期的生产持久化命名卷。"
done
schema_revision="$(compose exec -T postgres sh -eu -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "SELECT version_num FROM alembic_version;"')" ||
  fail '无法读取既有数据库迁移版本；请先确认恢复了正确的生产库。'
[[ "$schema_revision" =~ ^[a-zA-Z0-9_]+$ ]] || fail '既有数据库 alembic_version 必须包含一个非空版本。'

backend_ref="$BACKEND_IMAGE:$RELEASE_TAG"
web_ref="$WEB_IMAGE:$RELEASE_TAG"
echo "拉取并核对生产镜像，版本 ${RELEASE_TAG}。"
compose pull api web worker beat
for image in "$backend_ref" "$web_ref"; do
  [ "$("$DOCKER_BIN" image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" = linux/arm64 ] || fail "镜像 $image 不是 Linux ARM64。"
  [ "$("$DOCKER_BIN" image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$GITHUB_SHA" ] || fail "镜像 $image 的 revision 与本次提交不一致。"
done

backup_dir="$PRODUCTION_PATH/backups"
mkdir -p "$backup_dir"
backup_file="$backup_dir/predeploy-$RELEASE_TAG.dump"
[ ! -e "$backup_file" ] || fail '本版本的发布前备份已存在；请保留原备份并核查重复发布。'
backup_tmp=''
release_tmp=''
compose_tmp=''
previous_tmp=''
deployment_phase='准备完成，尚未停止业务服务'
deployment_success=false
beat_may_be_running=false
cleanup() {
  local status=$?
  [ -z "$backup_tmp" ] || rm -f -- "$backup_tmp"
  [ -z "$release_tmp" ] || rm -f -- "$release_tmp"
  [ -z "$compose_tmp" ] || rm -f -- "$compose_tmp"
  [ -z "$previous_tmp" ] || rm -f -- "$previous_tmp"
  if [ "$deployment_success" != true ]; then
    if [ "$beat_may_be_running" = true ]; then
      compose stop --timeout 60 beat || true
    fi
    echo "发布失败，现场阶段：${deployment_phase}。" >&2
    echo '未自动回退数据库或镜像；已停止的 beat 保持停止，请先确认数据库迁移及运行容器状态。' >&2
    compose ps -a || true
  fi
  exit "$status"
}
trap cleanup EXIT

deployment_phase='停止定时任务'
compose stop --timeout 60 beat
deployment_phase='等待 API 与 Worker 优雅停止（最多 600 秒）'
compose stop --timeout 600 worker api
deployment_phase='备份迁移前的 PostgreSQL'
backup_tmp="$(mktemp "$backup_dir/.predeploy-$RELEASE_TAG.XXXXXX")"
compose exec -T postgres sh -eu -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_tmp"
[ -s "$backup_tmp" ] || fail '数据库备份为空，未执行迁移。'
mv "$backup_tmp" "$backup_file"
backup_tmp=''
echo "迁移前备份已保存：$backup_file"

deployment_phase='使用新后端镜像执行数据库迁移'
compose run --rm --no-deps api flask --app backend.app db upgrade
deployment_phase='启动 API、Worker 与 Web 并等待健康检查'
compose up -d --no-deps --no-build --force-recreate --wait --wait-timeout 180 api worker web

verify_running_image() {
  local service=$1 expected_ref=$2 container_id expected_id
  container_id="$(container_for "$service")"
  expected_id="$("$DOCKER_BIN" image inspect --format '{{.Id}}' "$expected_ref")"
  [ "$("$DOCKER_BIN" container inspect --format '{{.State.Status}}' "$container_id")" = running ] || fail "$service 未运行。"
  [ "$("$DOCKER_BIN" container inspect --format '{{.Image}}' "$container_id")" = "$expected_id" ] || fail "$service 实际镜像与本次发布不一致。"
}
verify_running_image api "$backend_ref"
verify_running_image worker "$backend_ref"
verify_running_image web "$web_ref"

deployment_phase='核对宿主 HTTP 健康接口中的完整提交版本'
web_address="$(compose port web 80)"
[[ "$web_address" != *$'\n'* ]] || fail 'Web 端口映射不唯一。'
web_port="${web_address##*:}"
[[ "$web_port" =~ ^[0-9]+$ ]] || fail '无法获取 Web 宿主端口。'
health_response="$(curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:$web_port/api/health")"
revision_pattern='"revision"[[:space:]]*:[[:space:]]*"([a-f0-9]{40})"'
[[ "$health_response" =~ $revision_pattern ]] && [ "${BASH_REMATCH[1]}" = "$GITHUB_SHA" ] || fail 'HTTP 健康接口返回的 revision 不匹配。'

deployment_phase='启动并核对唯一 Beat'
beat_may_be_running=true
compose up -d --no-deps --no-build --force-recreate --wait --wait-timeout 90 beat
verify_running_image beat "$backend_ref"

deployment_phase='原子保存本次成功发布版本'
release_tmp="$(mktemp "$PRODUCTION_PATH/.release.env.XXXXXX")"
compose_tmp="$(mktemp "$PRODUCTION_PATH/.compose.prod.yml.XXXXXX")"
cp "$BUNDLE_ROOT/deploy/compose.prod.yml" "$compose_tmp"
{
  printf 'BACKEND_IMAGE=%s\n' "$BACKEND_IMAGE"
  printf 'WEB_IMAGE=%s\n' "$WEB_IMAGE"
  printf 'RELEASE_TAG=%s\n' "$RELEASE_TAG"
} > "$release_tmp"
if [ -f "$PRODUCTION_PATH/release.env" ]; then
  previous_tmp="$(mktemp "$PRODUCTION_PATH/.previous-release.env.XXXXXX")"
  cp "$PRODUCTION_PATH/release.env" "$previous_tmp"
  mv "$previous_tmp" "$PRODUCTION_PATH/previous-release.env"
  previous_tmp=''
fi
mv "$compose_tmp" "$PRODUCTION_PATH/compose.prod.yml"
compose_tmp=''
mv "$release_tmp" "$PRODUCTION_PATH/release.env"
release_tmp=''
deployment_success=true
echo "生产发布成功：${RELEASE_TAG}，revision=${GITHUB_SHA}。"
compose ps
