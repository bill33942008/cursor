require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { initSchema } = require("./db");

const authRoutes = require("./routes/auth");
const journeyRoutes = require("./routes/journeys");
const postRoutes = require("./routes/posts");
const friendRoutes = require("./routes/friends");
const groupRoutes = require("./routes/groups");

const app = express();
const port = Number(process.env.PORT || 3000);

initSchema();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "tongxing-server", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/journeys", journeyRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/friends", friendRoutes);
app.use("/api/groups", groupRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "internal server error" });
});

app.listen(port, () => {
  console.log(`tongxing-server listening at http://localhost:${port}`);
});
