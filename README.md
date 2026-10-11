<div align="center">
  <img src="cinebridge/static/icon.svg" width="72" alt="CineBridge">
  <h1>片桥 CineBridge</h1>
  <p>把一个「想看」，接到自己的片库。</p>
  <p>Self-hosted · Web + CLI · Your accounts, your sources</p>
</div>

片桥是一个本地运行的影视自动化中台。把用户自己的豆瓣公开片单、资源目录、CloudDrive2 和 115 串起来：搜片、列出候选、导出磁力、提交离线下载，再验证入库。

**项目不提供内置资源站、共享账号、共享接口或代理下载服务。** 只有 115、豆瓣和 CD2 账号仍不足以搜索资源；请接入自己的资源源，或导入自己的种子与磁力。115 在 CD2 中绑定，片桥不接收 115 密码。

当前为 **0.1.0 初始版本**。已完成隔离协议与端到端测试；第三方生产账号兼容性需要用户在自己的环境验证，详见 [验收记录](docs/VERIFICATION.md)。

## 可以做什么

- 独立 Web 工作台：概览、搜片、片单订阅、任务中心、媒体库、连接管理。
- CLI 与 Web 共用后端，支持 JSON 输出，适合脚本和 Agent。
- AList 兼容目录搜索、JSON 资源目录、`.torrent` / 磁力导入。
- 只搜索、列种子、复制或导出磁力，无需配置下载器。
- 使用用户授权的 CD2 API 令牌向 CD2 已连接的 115 提交离线任务。
- 持久队列、资源哈希去重、重启恢复、提交结果不确定时核对远端。
- 豆瓣想看 / 在看 / 看过公开片单，完整分页与首次历史基线。
- 新增条目自动匹配，待找资源每 6 小时补找。
- 为每项任务创建独立目录；下载完成后验证媒体文件，才标记入库。
- 第三方连接配置加密保存，令牌不回传页面，无外部字体、CDN 或遥测。

## 一键本地部署

准备 Docker Engine + Compose v2，或 Docker Desktop。一行安装：

```bash
curl -fsSL https://raw.githubusercontent.com/tainanzhui/cinebridge/v0.1.0/scripts/install.sh | bash
```

也可以先下载并审阅安装脚本。取得项目后，在项目目录运行：

```bash
bash scripts/install.sh
```

脚本构建并启动容器，等待健康检查，然后显示本机地址和访问密钥。默认只监听 `127.0.0.1:8766`。如端口已占用：

```bash
CINEBRIDGE_PORT=8877 bash scripts/install.sh
```

也可以直接：

```bash
docker compose up -d --build --wait
```

打开 **http://127.0.0.1:8766**。读取登录密钥：

```bash
docker compose exec cinebridge cinebridge token
```

安装脚本默认从公开仓库 `tainanzhui/cinebridge` 获取代码。Fork 使用者可以通过 `CINEBRIDGE_REPO=owner/repo` 覆盖仓库地址；此设置仅用于安装，不是资源或下载接口。

### 首次配置

1. **资源源**：添加自己 AList 兼容服务的地址、API 令牌与搜索根目录；该服务需要已建立搜索索引。也可选择 JSON 目录或直接导入磁力。
2. **CD2 / 115**：在自己的 CD2 中登录 115，创建入库根目录，并生成具有目录读取、创建文件夹、离线下载及任务查询权限的 API 令牌。在片桥填写 CD2 地址、令牌和完整云盘路径。
3. **搜片**：搜索片名，查看候选资源。选择下载连接再点下载；或只复制、导出磁力。
4. **豆瓣订阅**：填写豆瓣用户 ID，选择公开片单。默认首次只建基线，不下载全部历史。自动下载需要单独勾选并选择下载连接。

CD2 与片桥在同一台 Docker Desktop 主机时，可用 `http://host.docker.internal:19798`（端口以你自己的 CD2 为准）。容器里的 `localhost` 指容器自身。片桥不安装、分发或替你激活 CD2，也不挂载宿主机文件系统。

## CLI

容器内已提供 CLI，将 `cinebridge` 替换为 `docker compose exec -T cinebridge cinebridge` 即可运行。

```bash
cinebridge status --json
cinebridge connections --json
cinebridge connections add --kind alist --name "我的目录" --endpoint https://catalog.example --root /Films
cinebridge connections add --kind cd2 --name "我的 CD2" --endpoint http://localhost:19798 --root /115/Movies
cinebridge connections test CONNECTION_ID
cinebridge search "电影名称" --json
cinebridge import --title "我的影片 2026" --torrent ./my-film.torrent
cinebridge download RESOURCE_ID --to CONNECTION_ID
cinebridge tasks --json
cinebridge library --json
cinebridge export "电影名称" > magnets.txt
cinebridge subscriptions add --name "我的片单" --user DOUBAN_USER_ID
cinebridge subscriptions sync SUBSCRIPTION_ID
cinebridge watchlist --json
```

添加连接时交互输入第三方令牌，避免写进命令历史。脚本调用可使用 `--token-file`；无令牌的公开 JSON 目录使用 `--no-token`。

客户端默认访问 `http://127.0.0.1:8766`，可设置 `CINEBRIDGE_URL`。访问密钥从数据目录读取，也可设置 `CINEBRIDGE_TOKEN_FILE`。不要把访问密钥写进公开脚本。

### Python 本地运行

macOS / Linux，Python 3.11+：

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.lock
pip install --no-deps .
cinebridge serve
```

另开一个终端运行 `cinebridge token` 取登录密钥。Windows 请使用 Docker；当前单实例锁使用 POSIX 文件锁。

## JSON 资源目录

配置指向用户自己托管的 JSON 文件，最大 8 MiB / 10000 条。例如：

```json
{
  "items": [
    {
      "title": "Your Film",
      "year": 2026,
      "resolution": 1080,
      "size": 1073741824,
      "magnet": "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567"
    }
  ]
}
```

以上哈希仅示意，不代表可下载资源。`size` 是媒体字节数；AList 搜索得到的种子文件大小不会冒充电影大小。

## 状态与默认规则

`等待提交 → 提交中 → 已提交 / 下载中 → 验证文件中 → 已入库`

- 提交不等于下载完成；完成需 CD2 任务成功和任务目录中的媒体文件证据。
- 重启前正在提交的任务进入待核对状态，禁止自动重复提交。
- 同一下载连接按 BTIH 哈希持久去重。
- 下载目录为 `根目录/影片名称 [哈希前缀]/`，不会自动改名或删除已有文件。
- 自动匹配采用规范化片名精确匹配；有年份时必须一致。优先非原盘，再按清晰度排序。
- 豆瓣每 10 分钟检查一次，分页有数量/结构异常或验证码时不更新基线。
- 失败任务可在处理 CD2 失败记录后手动重试；不确定提交必须先确认远端没有此任务，再点击“核对后重试”或使用 CLI 的 `--confirm-not-submitted`。

## 数据与升级

Docker 数据在命名卷 `cinebridge-data` 中，包括 SQLite、加密主密钥和访问密钥。Python 默认目录为 `~/.local/share/cinebridge`，可用 `CINEBRIDGE_DATA` 修改。

备份时先停止服务，完整备份数据卷；**数据库和 `master.key` 必须一起保存**。丢失主密钥无法恢复连接凭据。升级先备份，再拉取代码、重建容器。普通 `docker compose down` 保留卷；不要使用 `down -v` 删除你的数据。

这是单用户、单进程、可信本地部署工具。默认不开放公网。需要远程访问时，部署者应自行配置 HTTPS 和额外访问控制。连接器由管理员配置，可以访问局域网服务，因此不要把管理密钥共享给不可信用户。

## 当前边界

- 115 通过 CD2 接入，尚未提供独立 115 OAuth 连接器。
- 豆瓣是公开片单的单向同步，不保证第三方页面永久可访问，不绕过验证码或反爬限制。
- 暂不含 TMDB 元数据刮削、剧集逐集追更、通知推送、用户自定义排序、容量迁移与自动清理。
- 媒体库展示本工具验证入库的任务，尚不扫描已有全量片库。
- 文件验证证明任务成功且媒体文件存在，不执行全文件下载/解码或完整性校验。
- BT v1 和混合种子支持；纯 v2 种子暂不支持。
- 网盘离线额度、账号权益、第三方 API 与 CD2 版本仍影响实际下载结果。

使用自己有权访问的资源。项目不包含、提供或销售影视资源。

## 开发

```bash
pip install -e '.[dev]'
pytest -q
ruff check cinebridge tests
node --check cinebridge/static/app.js
```

[架构与扩展](docs/ARCHITECTURE.md) · [协议来源](docs/PROTOCOLS.md) · [安全说明](SECURITY.md) · [贡献指南](CONTRIBUTING.md)

Apache-2.0。公开核心允许修改与分发；不包含任何私人后端、旧系统代码或账号数据。
