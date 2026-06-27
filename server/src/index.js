require("dotenv").config();
const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { initializeDatabase, initSchema } = require("./db");
const { setupRealtime } = require("./realtime/hub");
const { ensureBootstrapAdmin, hasAdminJwtSecret } = require("./services/adminAuth");

const authRoutes = require("./routes/auth");
const journeyRoutes = require("./routes/journeys");
const postRoutes = require("./routes/posts");
const friendRoutes = require("./routes/friends");
const groupRoutes = require("./routes/groups");
const mediaRoutes = require("./routes/media");
const adminRoutes = require("./routes/admin");
const userRoutes = require("./routes/users");
const sceneRoutes = require("./routes/scenes");

const app = express();
const port = Number(process.env.PORT || 3000);

async function bootstrap() {
  await initializeDatabase();
  initSchema();
  await ensureBootstrapAdmin();
  if (!hasAdminJwtSecret()) {
    console.warn(
      "[admin] ADMIN_JWT_SECRET is not configured (or too short). /api/admin/auth/login will return 503 until it is set."
    );
  }

  const adminWebRoot = path.join(process.cwd(), "admin-web");

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false,
    })
  );
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan("dev"));
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
  app.use("/admin", express.static(adminWebRoot));

  app.get("/", (_req, res) => {
    res.json({
      service: "tongxing-server",
      message: "service is running",
      docs: {
        health: "/health",
        api: "/api",
        adminWeb: "/admin",
      },
      time: new Date().toISOString(),
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "tongxing-server", time: new Date().toISOString() });
  });

  app.get("/admin", (_req, res) => {
    res.sendFile(path.join(adminWebRoot, "index.html"));
  });
  app.get("/admin/*splat", (_req, res) => {
    res.sendFile(path.join(adminWebRoot, "index.html"));
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/journeys", journeyRoutes);
  app.use("/api/posts", postRoutes);
  app.use("/api/friends", friendRoutes);
  app.use("/api/groups", groupRoutes);
  app.use("/api/media", mediaRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/scenes", sceneRoutes);
  app.use("/api/admin", adminRoutes);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ message: "internal server error" });
  });

  const server = http.createServer(app);
  setupRealtime(server);

  server.listen(port, () => {
    console.log(`tongxing-server listening at http://localhost:${port}`);
  });
}

bootstrap().catch((err) => {
  console.error("failed to bootstrap server", err);
  process.exit(1);
});
