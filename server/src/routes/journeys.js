const express = require("express");
const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../db");
const { authRequired } = require("../middleware/auth");
const { parsePagination } = require("../utils");

const router = express.Router();

const transportValues = ["high_speed_rail", "flight", "train", "road_trip", "bus", "other"];
const phaseValues = ["preparing", "boarding", "on_the_way", "arrived"];

const journeySchema = z.object({
  transportType: z.enum(transportValues),
  routeCode: z.string().max(32).optional(),
  origin: z.string().min(1).max(64),
  destination: z.string().min(1).max(64),
  phase: z.enum(phaseValues),
  departureWindow: z.string().max(64).optional(),
  visibility: z.enum(["public", "friends", "private"]).default("public"),
});

router.post("/status", authRequired, (req, res) => {
  const parsed = journeySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid journey payload", errors: parsed.error.issues });
  }

  const data = parsed.data;

  const existing = db
    .prepare("SELECT id FROM journeys WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(req.user.id);

  if (existing) {
    db.prepare(
      `
      UPDATE journeys
      SET transport_type = ?, route_code = ?, origin = ?, destination = ?, phase = ?,
          departure_window = ?, visibility = ?, updated_at = datetime('now')
      WHERE id = ?
      `
    ).run(
      data.transportType,
      data.routeCode || null,
      data.origin,
      data.destination,
      data.phase,
      data.departureWindow || null,
      data.visibility,
      existing.id
    );
  } else {
    db.prepare(
      `
      INSERT INTO journeys (
        id, user_id, transport_type, route_code, origin, destination, phase, departure_window, visibility
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      uuidv4(),
      req.user.id,
      data.transportType,
      data.routeCode || null,
      data.origin,
      data.destination,
      data.phase,
      data.departureWindow || null,
      data.visibility
    );
  }

  const latest = db
    .prepare(
      `
      SELECT id, transport_type AS transportType, route_code AS routeCode, origin, destination, phase,
             departure_window AS departureWindow, visibility, updated_at AS updatedAt
      FROM journeys
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
      `
    )
    .get(req.user.id);

  res.json({ journey: latest });
});

router.get("/feed", authRequired, (req, res) => {
  const { limit, offset } = parsePagination(req.query);
  const transportType = req.query.transportType;
  const destination = req.query.destination;

  let baseQuery = `
    SELECT
      j.id,
      j.transport_type AS transportType,
      j.route_code AS routeCode,
      j.origin,
      j.destination,
      j.phase,
      j.departure_window AS departureWindow,
      j.updated_at AS updatedAt,
      u.id AS userId,
      u.nickname
    FROM journeys j
    JOIN users u ON u.id = j.user_id
    WHERE j.visibility = 'public'
  `;
  const params = [];

  if (transportType) {
    baseQuery += " AND j.transport_type = ?";
    params.push(transportType);
  }
  if (destination) {
    baseQuery += " AND j.destination LIKE ?";
    params.push(`%${destination}%`);
  }

  baseQuery += " ORDER BY j.updated_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const items = db.prepare(baseQuery).all(...params);
  res.json({ items, pagination: { limit, offset } });
});

module.exports = router;
