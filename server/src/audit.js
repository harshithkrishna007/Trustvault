
import express from "express";
import { pool } from "./postgres.js";

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const userResult = await pool.query(
      `SELECT id, role, disabled
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.session.userId]
    );

    const user = userResult.rows[0];

    if (!user || user.disabled) {
      return res.status(401).json({ error: "Authentication required." });
    }

    if (user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required." });
    }

    const result = await pool.query(
      `SELECT
         a.id,
         a.actor_id,
         actor.name AS actor_name,
         a.action,
         a.document_id,
         d.name AS document_name,
         a.target_user_id,
         target.name AS target_user_name,
         a.outcome,
         a.details_json,
         a.created_at,
         a.previous_hash,
         a.event_hash,
         a.event_payload
       FROM audit_events a
       LEFT JOIN users actor ON actor.id = a.actor_id
       LEFT JOIN users target ON target.id = a.target_user_id
       LEFT JOIN documents d ON d.id = a.document_id
       ORDER BY a.id DESC
       LIMIT 200`
    );

    return res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

export default router;
