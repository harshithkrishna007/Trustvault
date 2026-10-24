
import { createHash, randomUUID } from "node:crypto";
import { pool } from "./postgres.js";

/**
 * Record a tamper-evident audit event.
 * PostgreSQL transaction locks the audit chain while adding an event.
 */
export async function audit({
  actorId = null,
  action,
  documentId = null,
  targetUserId = null,
  outcome,
  details = {}
}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Serialize audit-chain updates to prevent concurrent hash-chain forks.
    await client.query(
      "SELECT pg_advisory_xact_lock($1, $2)",
      [784512, 1]
    );

    const headResult = await client.query(
      "SELECT event_hash FROM audit_heads WHERE id = 1"
    );

    const previousHash = headResult.rows[0]?.event_hash ?? null;

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

    const eventPayload = JSON.stringify(event);
    const eventHash = createHash("sha256")
      .update(eventPayload)
      .digest("hex");

    await client.query(
      `INSERT INTO audit_events (
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
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
      ]
    );

    await client.query(
      `INSERT INTO audit_heads (id, event_hash)
       VALUES (1, $1)
       ON CONFLICT (id)
       DO UPDATE SET event_hash = EXCLUDED.event_hash`,
      [eventHash]
    );

    await client.query("COMMIT");
    return eventHash;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Return a document only if the user is allowed to access it.
 * Returns null when the document is unavailable or access is denied.
 */
export async function getDocumentAccess(userId, documentId) {
  const result = await pool.query(
    `SELECT
       d.*,
       CASE
         WHEN d.owner_id = $1 THEN 'owner'
         WHEN u.role = 'admin' THEN 'admin'
         ELSE g.permission
       END AS access_level
     FROM documents d
     JOIN users u ON u.id = $1
     LEFT JOIN grants g
       ON g.document_id = d.id
       AND g.user_id = $1
     WHERE d.id = $2
       AND d.deleted_at IS NULL
       AND u.disabled = FALSE
       AND (
         d.owner_id = $1
         OR u.role = 'admin'
         OR g.user_id = $1
       )
     LIMIT 1`,
    [userId, documentId]
  );

  return result.rows[0] ?? null;
}
