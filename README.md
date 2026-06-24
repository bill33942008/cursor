# 同行 / 在路上 - 微信小程序 V2

这是一个可直接启动的 MVP 工程，覆盖了你提出的核心方向：

- 在路上用户广场（可匿名）
- 行程状态（高铁/飞机/火车/自驾等）
- 好友申请与好友关系
- 同行群组（创建、加入、解散、群消息）
- 举报能力与审核风控
- WebSocket 实时群聊
- 媒体上传（本地存储 / 腾讯 COS）
- 完整管理后台（登录、仪表盘、用户管理、图片审核、举报处理）

## 仓库结构

```text
.
├── docs
│   ├── api.md
│   └── solution.md
├── infra
│   └── docker-compose.yml
├── miniprogram
│   ├── app.js
│   ├── app.json
│   └── pages
└── server
    ├── package.json
    ├── sql
    │   └── schema-postgres.sql
    └── src
```

## 1. 启动后端服务

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

默认监听：`http://localhost:3000`

健康检查：`GET /health`

WebSocket 地址：`ws://localhost:3000/ws?token=<accessToken>`

管理后台地址：`http://localhost:3000/admin`

如果你不想使用环境变量自动创建管理员，也可以手动执行：

```bash
cd server
npm run admin:create -- admin "StrongPass!123"
```

## 2. 启动微信小程序

1. 打开微信开发者工具
2. 导入目录 `miniprogram`
3. 在 `miniprogram/app.js` 确认 `baseUrl` 指向你的后端（本地开发默认 `http://localhost:3000`）
4. 编译运行

> 注意：真机调试时 `localhost` 不可访问，需要改成你的局域网 IP 或线上域名。

## 3. 数据库说明

- 本地可运行版本：SQLite（基于 `sql.js`，自动初始化，无需本地 C++ 编译环境）
- 生产推荐版本：PostgreSQL + Redis（见 `infra/docker-compose.yml` 与 `server/sql/schema-postgres.sql`）

## 4. 环境变量（核心）

见 `server/.env.example`，重点如下：

1. 登录模式
   - `WECHAT_LOGIN_MODE=mock`：开发态 mock 登录
   - `WECHAT_LOGIN_MODE=real`：启用微信 `code2Session` 真登录（需配置 `WECHAT_APPID/WECHAT_SECRET`）
2. 内容安全
   - `WECHAT_SECURITY_ENABLED=true` 后启用微信安全审核接口
   - `CUSTOM_BLOCKED_WORDS` 可追加自定义关键词
3. 媒体存储
   - 不配置 COS 时，默认本地存储到 `/uploads`
   - 配置 `COS_*` 后自动切换到腾讯 COS
4. 管理端
   - `ADMIN_JWT_SECRET`：后台 JWT 签名密钥（必填）
   - `ADMIN_INIT_USERNAME/ADMIN_INIT_PASSWORD`：首次启动自动创建管理员
   - `ADMIN_TOKEN`：兼容旧脚本的临时 token（可选，不建议生产使用）

## 5. V2 新增能力说明

1. 发帖改为使用 `mediaAssetIds`（先上传媒体，再发帖）
2. 帖子/群消息/群资料均接入审核管道（approved/review/rejected）
3. 群聊支持 WebSocket 实时推送
4. 新增完整管理后台：
   - 管理员账号密码登录（bcrypt 哈希 + JWT）
   - 实时运营看板（在线人数、DAU、MAU、增长、待审核量）
   - 用户管理（搜索、封禁/解封）
   - 图片/视频审核（通过/拒绝）
   - 动态审核（通过/拒绝）
   - 举报处理（resolved/dismissed）
   - 管理员操作审计日志

## 6. 后台安全建议（务必）

1. 生产环境使用 HTTPS（反向代理 Nginx 或网关 TLS）
2. 设置高强度 `ADMIN_JWT_SECRET`，至少 32 字符随机串
3. 使用强密码初始化管理员，首次登录后立即修改
4. 登录接口已内置限流（防暴力破解），仍建议网关层追加 WAF/IP 限速
5. 建议禁用 `ADMIN_TOKEN`（仅保留 JWT）

## 7. 文档

- 架构与功能方案：`docs/solution.md`
- 接口清单：`docs/api.md`
