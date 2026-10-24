
import express from "express";
import multer from "multer";
import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { pool } from "./postgres.js";
import { audit, getDocumentAccess } from "./security.js";

const router = express.Router();

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const BUCKET = "trustvault-documents";

const allowedTypes = new Set([
  "application/pdf",
  "text/plain",
  "image/png",
  "image/jpeg"
]);

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 }
});

function requireUser(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Authentication required." });
  }
  next();
}

async function getActiveUser(userId) {
  const result = await pool.query(
    `SELECT id, name, email, role, disabled
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );

  const user = result.rows[0];
  return user && !user.disabled ? user : null;
}

async function requireDocumentAccess(req, res, documentId) {
  const access = await getDocumentAccess(req.session.userId, documentId);

  if (!access) {
    await audit({
      actorId: req.session.userId,
      action: "document_access",
      documentId,
      outcome: "denied",
      details: { reason: "Document unavailable or access denied" }
    });

    res.status(404).json({ error: "Document not found or access denied." });
    return null;
  }

  return access;
}

function canEdit(access) {
  return ["owner", "admin", "edit"].includes(access.access_level);
}

function validText(value, maxLength) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength;
}

// List documents available to the current user.
router.get("/", requireUser, async (req, res, next) => {
  try {
    const user = await getActiveUser(req.session.userId);

    if (!user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const result = await pool.query(
      `SELECT DISTINCT
         d.id,
         d.owner_id,
         d.name,
         d.category,
         d.mime_type,
         d.size,
         d.sha256,
         d.created_at,
         d.updated_at,
         u.name AS owner_name,
         CASE
           WHEN d.owner_id = $1 THEN 'owner'
           WHEN $2 = 'admin' THEN 'admin'
           ELSE g.permission
         END AS access_level
       FROM documents d
       JOIN users u ON u.id = d.owner_id
       LEFT JOIN grants g
         ON g.document_id = d.id AND g.user_id = $1
       WHERE d.deleted_at IS NULL
         AND (
           d.owner_id = $1
           OR $2 = 'admin'
           OR g.user_id = $1
         )
       ORDER BY d.created_at DESC`,
      [user.id, user.role]
    );

    return res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Upload a document to private Supabase Storage.
router.post("/", requireUser, upload.single("file"), async (req, res, next) => {
  let storageKey;

  try {
    const user = await getActiveUser(req.session.userId);

    if (!user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    if (!["owner", "admin"].includes(user.role)) {
      return res.status(403).json({ error: "You cannot upload documents." });
    }

    const file = req.file;
    const { name, category } = req.body;

    if (!file) {
      return res.status(400).json({ error: "Please select a file." });
    }

    if (!allowedTypes.has(file.mimetype)) {
      return res.status(400).json({
        error: "Only PDF, TXT, PNG, and JPEG files are allowed."
      });
    }

    if (!validText(name, 150) || !validText(category, 80)) {
      return res.status(400).json({
        error: "Name is required (max 150 characters) and category is required (max 80 characters)."
      });
    }

    const documentId = randomUUID();
    storageKey = `${user.id}/${documentId}/${randomUUID()}`;
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storageKey, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (uploadError) {
      throw uploadError;
    }

    try {
      const result = await pool.query(
        `INSERT INTO documents (
           id, owner_id, name, category, mime_type, size,
           storage_key, sha256
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING
           id, owner_id, name, category, mime_type, size,
           sha256, created_at, updated_at`,
        [
          documentId,
          user.id,
          name.trim(),
          category.trim(),
          file.mimetype,
          file.size,
          storageKey,
          sha256
        ]
      );

      await audit({
        actorId: user.id,
        action: "document_upload",
        documentId,
        outcome: "success",
        details: { name: name.trim(), size: file.size }
      });

      return res.status(201).json(result.rows[0]);
    } catch (error) {
      // Avoid leaving an unreferenced object if metadata creation fails.
      const { error: cleanupError } = await supabase.storage
        .from(BUCKET)
        .remove([storageKey]);

      if (cleanupError) {
        console.error("Storage cleanup failed:", cleanupError.message);
      }

      throw error;
    }
  } catch (error) {
    next(error);
  }
});

// Download a document after checking permissions.
router.get("/:id/download", requireUser, async (req, res, next) => {
  try {
    const user = await getActiveUser(req.session.userId);

    if (!user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const access = await requireDocumentAccess(req, res, req.params.id);
    if (!access) return;

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(access.storage_key);

    if (error || !data) {
      await audit({
        actorId: user.id,
        action: "document_download",
        documentId: access.id,
        outcome: "failure",
        details: { reason: "Storage download failed" }
      });

      return res.status(502).json({ error: "Unable to retrieve document." });
    }

    const buffer = Buffer.from(await data.arrayBuffer());

    await audit({
      actorId: user.id,
      action: "document_download",
      documentId: access.id,
      outcome: "success"
    });

    res.setHeader("Content-Type", access.mime_type);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="document-${access.id}"`
    );
    res.setHeader("Content-Length", buffer.length);

    return res.send(buffer);
  } catch (error) {
    next(error);
  }
});

// Rename a document.
router.patch("/:id", requireUser, async (req, res, next) => {
  try {
    const user = await getActiveUser(req.session.userId);

    if (!user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const access = await requireDocumentAccess(req, res, req.params.id);
    if (!access) return;

    if (!canEdit(access)) {
      await audit({
        actorId: user.id,
        action: "document_rename",
        documentId: access.id,
        outcome: "denied"
      });
      return res.status(403).json({ error: "Edit permission required." });
    }

    const { name, category } = req.body;
    const updates = [];
    const values = [];
    let index = 1;

    if (name !== undefined) {
      if (!validText(name, 150)) {
        return res.status(400).json({ error: "Invalid document name." });
      }
      updates.push(`name = $${index++}`);
      values.push(name.trim());
    }

    if (category !== undefined) {
      if (!validText(category, 80)) {
        return res.status(400).json({ error: "Invalid category." });
      }
      updates.push(`category = $${index++}`);
      values.push(category.trim());
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid changes provided." });
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(access.id);

    const result = await pool.query(
      `UPDATE documents
       SET ${updates.join(", ")}
       WHERE id = $${index} AND deleted_at IS NULL
       RETURNING id, name, category, updated_at`,
      values
    );

    await audit({
      actorId: user.id,
      action: "document_update",
      documentId: access.id,
      outcome: "success",
      details: { changedFields: Object.keys(req.body).filter(
        key => ["name", "category"].includes(key)
      ) }
    });

    return res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// Soft-delete a document; the stored file is retained for recovery.
router.delete("/:id", requireUser, async (req, res, next) => {
  try {
    const user = await getActiveUser(req.session.userId);

    if (!user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const access = await requireDocumentAccess(req, res, req.params.id);
    if (!access) return;

    if (!canEdit(access)) {
      await audit({
        actorId: user.id,
        action: "document_delete",
        documentId: access.id,
        outcome: "denied"
      });
      return res.status(403).json({ error: "Delete permission denied." });
    }

    await pool.query(
      `UPDATE documents
       SET deleted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND deleted_at IS NULL`,
      [access.id]
    );

    await audit({
      actorId: user.id,
      action: "document_delete",
      documentId: access.id,
      outcome: "success"
    });

    return res.json({ message: "Document deleted successfully." });
  } catch (error) {
    next(error);
  }
});

// List grants for a document.
router.get("/:id/grants", requireUser, async (req, res, next) => {
  try {
    const user = await getActiveUser(req.session.userId);

    if (!user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const access = await requireDocumentAccess(req, res, req.params.id);
    if (!access) return;

    if (!canEdit(access)) {
      return res.status(403).json({ error: "Permission to manage grants denied." });
    }

    const result = await pool.query(
      `SELECT g.document_id, g.user_id, g.permission,
              g.granted_by, g.created_at,
              u.name, u.email
       FROM grants g
       JOIN users u ON u.id = g.user_id
       WHERE g.document_id = $1
       ORDER BY u.name`,
      [access.id]
    );

    return res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Create or update a user's read/edit grant.
router.put("/:id/grants/:userId", requireUser, async (req, res, next) => {
  const client = await pool.connect();

  try {
    const user = await getActiveUser(req.session.userId);

    if (!user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const access = await requireDocumentAccess(req, res, req.params.id);
    if (!access) return;

    if (!canEdit(access)) {
      return res.status(403).json({ error: "Permission to manage grants denied." });
    }

    const { permission } = req.body;

    if (!["read", "edit"].includes(permission)) {
      return res.status(400).json({ error: "Permission must be read or edit." });
    }

    if (req.params.userId === access.owner_id) {
      return res.status(400).json({ error: "The document owner already has access." });
    }

    const targetResult = await client.query(
      `SELECT id, role, disabled
       FROM users
       WHERE id = $1`,
      [req.params.userId]
    );

    const target = targetResult.rows[0];

    if (!target || target.disabled) {
      return res.status(404).json({ error: "Target user not found." });
    }

    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO grants (document_id, user_id, permission, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (document_id, user_id)
       DO UPDATE SET permission = EXCLUDED.permission,
                     granted_by = EXCLUDED.granted_by,
                     created_at = CURRENT_TIMESTAMP
       RETURNING document_id, user_id, permission, granted_by, created_at`,
      [access.id, target.id, permission, user.id]
    );

    await client.query("COMMIT");

    await audit({
      actorId: user.id,
      action: "grant_upsert",
      documentId: access.id,
      targetUserId: target.id,
      outcome: "success",
      details: { permission }
    });

    return res.json(result.rows[0]);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Transaction may already have been committed.
    }
    next(error);
  } finally {
    client.release();
  }
});

// Revoke a user's grant.
router.delete("/:id/grants/:userId", requireUser, async (req, res, next) => {
  try {
    const user = await getActiveUser(req.session.userId);

    if (!user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const access = await requireDocumentAccess(req, res, req.params.id);
    if (!access) return;

    if (!canEdit(access)) {
      return res.status(403).json({ error: "Permission to manage grants denied." });
    }

    const result = await pool.query(
      `DELETE FROM grants
       WHERE document_id = $1 AND user_id = $2
       RETURNING user_id`,
      [access.id, req.params.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Grant not found." });
    }

    await audit({
      actorId: user.id,
      action: "grant_revoke",
      documentId: access.id,
      targetUserId: req.params.userId,
      outcome: "success"
    });

    return res.json({ message: "Access revoked successfully." });
  } catch (error) {
    next(error);
  }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "File exceeds the 10 MB limit."
      : "File upload failed.";
    return res.status(400).json({ error: message });
  }

  next(error);
});

export default router;
