# 同行 / 在路上 - 微信小程序 MVP

这是一个可直接启动的 MVP 工程，覆盖了你提出的核心方向：

- 在路上用户广场（可匿名）
- 行程状态（高铁/飞机/火车/自驾等）
- 好友申请与好友关系
- 同行群组（创建、加入、解散、群消息）
- 举报能力与基础风控预留

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

## 2. 启动微信小程序

1. 打开微信开发者工具
2. 导入目录 `miniprogram`
3. 在 `miniprogram/app.js` 确认 `baseUrl` 指向你的后端（本地开发默认 `http://localhost:3000`）
4. 编译运行

> 注意：真机调试时 `localhost` 不可访问，需要改成你的局域网 IP 或线上域名。

## 3. 数据库说明

- 本地可运行版本：SQLite（自动初始化）
- 生产推荐版本：PostgreSQL + Redis（见 `infra/docker-compose.yml` 与 `server/sql/schema-postgres.sql`）

## 4. 关键说明

1. 当前登录为 MVP mock 实现（`/api/auth/wx-login` 使用 code 拼接模拟 openid）
2. 上线前必须替换为微信 `code2Session` 并接入正式 `openid/unionid`
3. 匿名只对前台匿名，后台保留账号映射
4. 上线前必须补齐内容审核后台和风控流程

## 5. 文档

- 架构与功能方案：`docs/solution.md`
- 接口清单：`docs/api.md`
