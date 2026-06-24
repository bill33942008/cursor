# 同行 / 在路上 API（MVP）

Base URL: `http://localhost:3000`

鉴权方式：`Authorization: Bearer <accessToken>`

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

## 3) 广场动态

### POST `/api/posts`

请求：

```json
{
  "content": "刚过安检，准备登机",
  "isAnonymous": true,
  "visibility": "public",
  "media": [],
  "journeyId": "uuid"
}
```

### GET `/api/posts/square?limit=20&offset=0`

获取广场信息流。

### POST `/api/posts/:id/like`

点赞动态（重复点赞会返回 `liked: false`）。

### POST `/api/posts/:id/report`

举报动态。

---

## 4) 好友系统

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

## 5) 群组系统

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

## 6) 健康检查

### GET `/health`

返回服务可用状态。
