
import { createHash, randomUUID } from "node:crypto";
import { db } from "./db.js";

export function audit({
  actorId = null,
  action,
  documentId = null,
  targetUserId = null,
  outcome,
  details = {}
}) {
  const write = db.transaction(() => {
    const head = db.prepare(
      "SELECT event_hash FROM audit_heads WHERE id = 1"
    ).get();

    const previousHash = head?.event_hash ?? null;

    const event = {
      id: randomUUID(),
      actorId,
      action,
      documentId,
      targetUserId,
      outcome,
      details,
      createdAt: new Date().toISOString(),
      previousHash
    };

    // Store the exact JSON string used to calculate the hash.
    const eventPayload = JSON.stringify(event);

    const eventHash = createHash("sha256")
      .update(eventPayload)
      .digest("hex");

    db.prepare(`
      INSERT INTO audit_events (
        actor_id,
        action,
        document_id,
        target_user_id,
        outcome,
        details_json,
        created_at,
        previous_hash,
        event_hash,
        event_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actorId,
      action,
      documentId,
      targetUserId,
      outcome,
      JSON.stringify(details),
      event.createdAt,
      previousHash,
      eventHash,
      eventPayload
    );

    // Update the head to point to the latest event.
    db.prepare(`
      INSERT INTO audit_heads (id, event_hash)
      VALUES (1, ?)
      ON CONFLICT(id)
      DO UPDATE SET event_hash = excluded.event_hash
    `).run(eventHash);
  });

  write();
}

export function getDocumentAccess(userId, documentId) {
  return db.prepare(`
    SELECT d.*,
      CASE
        WHEN d.owner_id = ? THEN 'owner'
        WHEN u.role = 'admin' THEN 'admin'
        ELSE g.permission
      END AS access_level
    FROM documents d
    JOIN users u ON u.id = ?
    LEFT JOIN grants g
      ON g.document_id = d.id AND g.user_id = ?
    WHERE d.id = ?
      AND d.deleted_at IS NULL
      AND (
        d.owner_id = ?
        OR u.role = 'admin'
        OR g.user_id = ?
      )
  `).get(
    userId,
    userId,
    userId,
    documentId,
    userId,
    userId
  );
}
