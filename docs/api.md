# 同行 / 在路上 API（V2）

Base URL: `http://localhost:3000`

鉴权方式：`Authorization: Bearer <accessToken>`

管理端鉴权（推荐）：`Authorization: Bearer <adminAccessToken>`

兼容旧模式：`x-admin-token: <ADMIN_TOKEN>`

---

## 1) 登录

### POST `/api/auth/wx-login`

请求：

```json
{
  "code": "wx_login_code",
  "nickname": "小明",
  "avatarUrl": "https://example.com/avatar.png"
}
```

响应：

```json
{
  "accessToken": "uuid-token",
  "expiresAt": "2026-07-01T00:00:00.000Z",
  "loginMode": "mock",
  "user": {
    "id": "uuid",
    "nickname": "小明",
    "avatarUrl": "https://example.com/avatar.png",
    "bio": null,
    "createdAt": "2026-06-24 00:00:00"
  }
}
```

### GET `/api/auth/me`

返回当前用户。

---

## 2) 行程状态

### POST `/api/journeys/status`

请求：

```json
{
  "transportType": "flight",
  "routeCode": "CZ3102",
  "origin": "深圳",
  "destination": "北京",
  "phase": "on_the_way",
  "departureWindow": "今天 13:00-15:00",
  "visibility": "public"
}
```

### GET `/api/journeys/feed?transportType=flight&destination=北京`

公开同行状态流。

---

## 3) 媒体上传（V2）

### POST `/api/media/upload`

`multipart/form-data`，字段名：`file`

响应：

```json
{
  "asset": {
    "id": "uuid",
    "userId": "uuid",
    "provider": "local",
    "storageKey": "media/2026/06/24/xxx.jpg",
    "url": "/uploads/2026/06/24/xxx.jpg",
    "mimeType": "image/jpeg",
    "sizeBytes": 12345,
    "moderationStatus": "approved",
    "moderationReason": null
  }
}
```

### GET `/api/media/my-assets`

获取当前用户媒体资产。

---

## 4) 广场动态

### POST `/api/posts`

请求：

```json
{
  "content": "刚过安检，准备登机",
  "isAnonymous": true,
  "visibility": "public",
  "mediaAssetIds": ["media-uuid"],
  "journeyId": "uuid"
}
```

### GET `/api/posts/square?limit=20&offset=0`

获取广场信息流。

### POST `/api/posts/:id/like`

点赞动态（重复点赞会返回 `liked: false`）。

### POST `/api/posts/:id/report`

举报动态。

### GET `/api/posts/:id/comments?limit=20&offset=0`

获取动态评论列表。

### POST `/api/posts/:id/comments`

```json
{
  "content": "同路！我也在这趟车上",
  "isAnonymous": false
}
```

---

## 5) 好友系统

### POST `/api/friends/request`

请求：

```json
{
  "toUserId": "uuid",
  "message": "你好，我也在路上"
}
```

### POST `/api/friends/request/:id/respond`

请求：

```json
{
  "action": "accept"
}
```

`action` 支持：`accept` / `reject`

### GET `/api/friends`

返回好友列表 + 收到的待处理申请。

---

## 6) 群组系统

### POST `/api/groups`

请求：

```json
{
  "name": "今晚北京落地互助群",
  "category": "destination",
  "destination": "北京",
  "routeCode": "",
  "description": "落地后拼车/问路互助",
  "expiresAt": "2026-06-26T10:00:00.000Z"
}
```

### GET `/api/groups/discover?category=destination&destination=北京`

群组广场。

### POST `/api/groups/:id/join`

加入群组。

### POST `/api/groups/:id/leave`

成员退群（群主不能调用）。

### POST `/api/groups/:id/disband`

群主解散群组。

### GET `/api/groups/:id/messages`

拉取群消息。

### POST `/api/groups/:id/messages`

请求：

```json
{
  "content": "我在T3航站楼，有人一起打车吗？",
  "isAnonymous": false
}
```

---

## 7) WebSocket（V2）

连接：

`ws://localhost:3000/ws?token=<accessToken>`

客户端发送：

```json
{ "type": "subscribe_group", "groupId": "group-uuid" }
```

服务端推送：

```json
{
  "type": "group_message",
  "groupId": "group-uuid",
  "message": {
    "id": "msg-uuid",
    "content": "我在T3航站楼",
    "displayName": "匿名群友",
    "createdAt": "2026-06-24 00:00:00"
  }
}
```

---

## 8) 管理端接口（V2）

### POST `/api/admin/auth/login`

```json
{
  "username": "admin",
  "password": "ReplaceMe!123"
}
```

返回管理员访问令牌（JWT）。

### GET `/api/admin/auth/me`

返回当前管理员身份。

### POST `/api/admin/auth/change-password`

```json
{
  "oldPassword": "OldPass!123",
  "newPassword": "NewPass!1234"
}
```

### GET `/api/admin/overview`

返回核心仪表盘统计，包含：

- 在线人数（onlineUsers）
- DAU / MAU
- 用户总量 / 今日新增 / 本月新增
- 待审核帖子 / 待审核媒体 / 待处理举报

### GET `/api/admin/trends?days=30`

返回按天趋势：DAU、新增用户、新增动态。

### GET `/api/admin/users?status=all&keyword=`

用户管理列表。

### POST `/api/admin/users/:id/status`

```json
{ "ban": true, "reason": "spam" }
```

### GET `/api/admin/media?status=review`

媒体审核队列。

### GET `/api/admin/posts?status=review`

动态审核队列。

### GET `/api/admin/reports?status=open|resolved|dismissed|all`

查看举报工单。

### POST `/api/admin/reports/:id/resolve`

```json
{ "status": "resolved" }
```

### POST `/api/admin/groups/:id/disband`

解散群组（管理操作）。

### POST `/api/admin/posts/:id/moderate`

```json
{ "status": "approved", "reason": "manual pass" }
```

### POST `/api/admin/media/:id/moderate`

```json
{ "status": "rejected", "reason": "unsafe image" }
```

---

## 9) 健康检查

### GET `/health`

返回服务可用状态。

---

## 10) 用户主页与时间线

### GET `/api/users/:id/public-profile`

返回用户公开资料、好友关系状态、时间线可见性。

### GET `/api/users/:id/timeline?limit=20&offset=0`

返回目标用户的公开时间线（若该用户未公开则 `allowed=false`）。

### GET `/api/users/me/timeline/visibility`

返回我的时间线对外可见开关。

### POST `/api/users/me/timeline/visibility`

```json
{ "timelineIsPublic": true }
```

### GET `/api/users/me/timeline?limit=20&offset=0`

获取我的时间线记录。

### POST `/api/users/me/timeline`

```json
{
  "title": "抵达杭州东",
  "location": "杭州东站",
  "note": "准备换乘地铁",
  "occurredAt": "2026-06-24T09:00:00.000Z",
  "isPublic": true
}
```

### PUT `/api/users/me/timeline/:eventId`

更新我的时间线记录。

### DELETE `/api/users/me/timeline/:eventId`

删除我的时间线记录。
