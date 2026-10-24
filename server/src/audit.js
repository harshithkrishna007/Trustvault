
import express from "express";
import { db } from "./db.js";

const router = express.Router();

// GET /api/audit
// Only active administrators can access audit logs.
router.get("/", (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({
        error: "Please log in to view audit logs.",
      });
    }

    const user = db
      .prepare(
        "SELECT id, role, disabled FROM users WHERE id = ?"
      )
      .get(req.session.userId);

    if (!user || user.disabled) {
      return res.status(401).json({
        error: "Your account is invalid or disabled.",
      });
    }

    if (user.role !== "admin") {
      return res.status(403).json({
        error: "Only administrators can view audit logs.",
      });
    }

    const logs = db
      .prepare(`
        SELECT
          ae.id,
          ae.actor_id AS actorId,
          COALESCE(u.name, u.email, ae.actor_id, 'System') AS actorName,
          ae.action,
          ae.document_id AS documentId,
          d.name AS documentName,
          ae.target_user_id AS targetUserId,
          ae.outcome AS status,
          ae.details_json AS details,
          ae.created_at AS createdAt,
          ae.event_hash AS eventHash,
          ae.previous_hash AS previousHash
        FROM audit_events AS ae
        LEFT JOIN users AS u
          ON u.id = ae.actor_id
        LEFT JOIN documents AS d
          ON d.id = ae.document_id
        ORDER BY ae.id DESC
        LIMIT 200
      `)
      .all();

    return res.json({ logs });
  } catch (error) {
    console.error("Error fetching audit logs:", error);

    return res.status(500).json({
      error: "Unable to load audit logs.",
    });
  }
});

export default router;
