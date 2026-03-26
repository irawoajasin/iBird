import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DB_PATH = process.env.DB_PATH || "./data/lines.db";

const db = await open({
  filename: DB_PATH,
  driver: sqlite3.Database
});

await db.exec(`
CREATE TABLE IF NOT EXISTS lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT,
  session_id TEXT,
  origin TEXT,
  geometry_type TEXT,
  user_distance_miles REAL,
  duration_ms INTEGER,
  line_count_this_session INTEGER,
  device_category TEXT,
  referrer TEXT,
  screen_width INTEGER,
  screen_height INTEGER,
  user_agent TEXT,
  feature_geojson TEXT
);
`);

app.get("/lines", async (req, res) => {
  const limit = parseInt(req.query.limit || "50", 10);
  const rows = await db.all(
    `SELECT *
     FROM lines
     ORDER BY datetime(created_at) DESC
     LIMIT ?`,
    limit
  );
  res.json(rows);
});

app.post("/lines", async (req, res) => {
  try {
    const {
      createdAt,
      sessionId,
      origin,
      geometryType,
      userDistanceMiles,
      durationMs,
      lineCountThisSession,
      analytics,
      featureGeoJSON
    } = req.body;

    await db.run(
      `INSERT INTO lines (
        created_at,
        session_id,
        origin,
        geometry_type,
        user_distance_miles,
        duration_ms,
        line_count_this_session,
        device_category,
        referrer,
        screen_width,
        screen_height,
        user_agent,
        feature_geojson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createdAt || new Date().toISOString(),
        sessionId || null,
        origin || null,
        geometryType || null,
        userDistanceMiles ?? null,
        durationMs ?? null,
        lineCountThisSession ?? null,
        analytics?.deviceCategory || null,
        analytics?.referrer || null,
        analytics?.screenWidth ?? null,
        analytics?.screenHeight ?? null,
        analytics?.userAgent || null,
        JSON.stringify(featureGeoJSON || null)
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /lines failed:", err);
    res.status(500).json({ ok: false, error: "Failed to save line" });
  }
});

app.get("/admin/rows", async (req, res) => {
  const rows = await db.all(
    `SELECT *
     FROM lines
     ORDER BY datetime(created_at) DESC
     LIMIT 500`
  );
  res.json(rows);
});

app.get("/admin/export.csv", async (req, res) => {
  const rows = await db.all(`
    SELECT
      id,
      created_at,
      origin,
      geometry_type,
      ROUND(user_distance_miles, 1) AS user_distance_miles,
      duration_ms,
      ROUND(duration_ms / 1000.0, 1) AS duration_seconds,
      line_count_this_session,
      device_category,
      referrer,
      screen_width,
      screen_height,
      user_agent,
      session_id
    FROM lines
    ORDER BY datetime(created_at) DESC
  `);

  const headers = [
    "id",
    "created_at",
    "origin",
    "geometry_type",
    "user_distance_miles",
    "duration_ms",
    "duration_seconds",
    "line_count_this_session",
    "device_category",
    "referrer",
    "screen_width",
    "screen_height",
    "user_agent",
    "session_id"
  ];

  const escapeCsv = (value) => {
    if (value == null) return "";
    const s = String(value);
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csv = [
    headers.join(","),
    ...rows.map(row => headers.map(h => escapeCsv(row[h])).join(","))
  ].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="ibird-analytics.csv"');
  res.send(csv);
});

app.get("/admin/summary", async (req, res) => {
  const totals = await db.get(`
    SELECT
      COUNT(*) AS total_interactions,
      COUNT(DISTINCT session_id) AS unique_sessions,
      ROUND(AVG(duration_ms) / 1000.0, 1) AS avg_duration_seconds,
      ROUND(AVG(user_distance_miles), 1) AS avg_distance_miles
    FROM lines
  `);

  const byDevice = await db.all(`
    SELECT
      COALESCE(device_category, 'unknown') AS device_category,
      COUNT(*) AS count
    FROM lines
    GROUP BY COALESCE(device_category, 'unknown')
    ORDER BY count DESC
  `);

  const topOrigins = await db.all(`
    SELECT
      origin,
      COUNT(*) AS count
    FROM lines
    WHERE origin IS NOT NULL AND TRIM(origin) != ''
    GROUP BY origin
    ORDER BY count DESC
    LIMIT 10
  `);

  const byGeometry = await db.all(`
    SELECT
      COALESCE(geometry_type, 'unknown') AS geometry_type,
      COUNT(*) AS count
    FROM lines
    GROUP BY COALESCE(geometry_type, 'unknown')
    ORDER BY count DESC
  `);

  res.json({
    totals,
    byDevice,
    byGeometry,
    topOrigins
  });
});

app.listen(3000, () => {
  console.log("Server on http://localhost:3000");
});