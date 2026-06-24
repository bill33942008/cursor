const { WebSocketServer } = require("ws");
const { db } = require("../db");

const groupSubscribers = new Map();

function sendJson(socket, payload) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function subscribeGroup(socket, groupId) {
  if (!groupSubscribers.has(groupId)) {
    groupSubscribers.set(groupId, new Set());
  }
  groupSubscribers.get(groupId).add(socket);
  socket.subscribedGroups.add(groupId);
}

function unsubscribeGroup(socket, groupId) {
  if (groupSubscribers.has(groupId)) {
    groupSubscribers.get(groupId).delete(socket);
    if (groupSubscribers.get(groupId).size === 0) {
      groupSubscribers.delete(groupId);
    }
  }
  socket.subscribedGroups.delete(groupId);
}

function unsubscribeAll(socket) {
  for (const groupId of socket.subscribedGroups) {
    unsubscribeGroup(socket, groupId);
  }
}

function authenticateByToken(token) {
  if (!token) {
    return null;
  }
  return db
    .prepare(
      `
      SELECT s.user_id AS userId, s.expires_at AS expiresAt, u.is_banned AS isBanned
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
      `
    )
    .get(token);
}

function setupRealtime(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");
    const session = authenticateByToken(token);
    if (!session || session.isBanned || new Date(session.expiresAt).getTime() < Date.now()) {
      sendJson(socket, { type: "error", message: "invalid session" });
      socket.close();
      return;
    }

    socket.userId = session.userId;
    socket.subscribedGroups = new Set();

    sendJson(socket, { type: "connected", userId: session.userId, at: new Date().toISOString() });

    socket.on("message", (raw) => {
      let payload = null;
      try {
        payload = JSON.parse(String(raw));
      } catch (_err) {
        sendJson(socket, { type: "error", message: "invalid json payload" });
        return;
      }

      if (payload.type === "ping") {
        sendJson(socket, { type: "pong", ts: Date.now() });
        return;
      }

      if (payload.type === "subscribe_group") {
        const groupId = payload.groupId;
        if (!groupId) {
          sendJson(socket, { type: "error", message: "groupId required" });
          return;
        }
        const isMember = db
          .prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?")
          .get(groupId, socket.userId);
        if (!isMember) {
          sendJson(socket, { type: "error", message: "join group first" });
          return;
        }
        subscribeGroup(socket, groupId);
        sendJson(socket, { type: "subscribed_group", groupId });
        return;
      }

      if (payload.type === "unsubscribe_group") {
        if (payload.groupId) {
          unsubscribeGroup(socket, payload.groupId);
        }
        sendJson(socket, { type: "unsubscribed_group", groupId: payload.groupId || null });
        return;
      }

      sendJson(socket, { type: "error", message: "unsupported ws event" });
    });

    socket.on("close", () => {
      unsubscribeAll(socket);
    });
  });

  return wss;
}

function broadcastGroupMessage(groupId, message) {
  const subscribers = groupSubscribers.get(groupId);
  if (!subscribers || subscribers.size === 0) {
    return;
  }
  const payload = {
    type: "group_message",
    groupId,
    message,
  };
  for (const socket of subscribers) {
    sendJson(socket, payload);
  }
}

module.exports = {
  setupRealtime,
  broadcastGroupMessage,
};
