function adminAuthRequired(req, res, next) {
  const expectedToken = process.env.ADMIN_TOKEN || "";
  if (!expectedToken) {
    return res.status(503).json({ message: "admin token not configured" });
  }

  const token = req.headers["x-admin-token"];
  if (!token || token !== expectedToken) {
    return res.status(401).json({ message: "invalid admin token" });
  }

  req.admin = { id: "admin-token" };
  next();
}

module.exports = {
  adminAuthRequired,
};
