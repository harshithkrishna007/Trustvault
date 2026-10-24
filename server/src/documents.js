
import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { db, STORAGE_DIR } from "./db.js";
import { audit, getDocumentAccess } from "./security.js";

const router = express.Router();
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const uploadDir = path.join(STORAGE_DIR, "files");
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 }
});

function requireUser(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  const user = db.prepare(`
    SELECT id, role, disabled FROM users WHERE id = ?
  `).get(req.session.userId);

  if (!user || user.disabled) {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  req.user = user;
  next();
}

function requireDocumentAccess(permission = "read") {
  return (req, res, next) => {
    const doc = getDocumentAccess(req.user.id, req.params.id);

    if (!doc) {
      audit({
        actorId: req.user.id,
        action: "document_access",
        documentId: req.params.id,
        outcome: "denied"
      });

      return res.status(404).json({
        error: "Document not found."
      });
    }

    if (
      permission === "edit" &&
      !["owner", "admin", "edit"].includes(doc.access_level)
    ) {
      audit({
        actorId: req.user.id,
        action: "document_edit",
        documentId: req.params.id,
        outcome: "denied"
      });

      return res.status(403).json({
        error: "Edit permission required."
      });
    }

    req.document = doc;
    next();
  };
}

// List documents the signed-in user is allowed to see.
router.get("/", requireUser, (req, res) => {
  const documents = db.prepare(`
    SELECT DISTINCT
      d.id,
      d.name,
      d.category,
      d.owner_id,
      d.mime_type,
      d.size,
      d.created_at,
      d.updated_at
    FROM documents d
    LEFT JOIN grants g ON g.document_id = d.id
    WHERE d.deleted_at IS NULL
      AND (
        d.owner_id = ?
        OR g.user_id = ?
        OR ? = 'admin'
      )
    ORDER BY d.created_at DESC
  `).all(req.user.id, req.user.id, req.user.role);

  res.json({ documents });
});

// Upload a document.
router.post(
  "/",
  requireUser,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          error: "Upload failed or file too large."
        });
      }

      next();
    });
  },
  (req, res) => {
    if (!["owner", "admin"].includes(req.user.role)) {
      if (req.file) {
        audit({
          actorId: req.user.id,
          action: "upload",
          outcome: "denied"
        });
      }

      return res.status(403).json({
        error: "Upload not permitted."
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "A file is required."
      });
    }

    const name = String(
      req.body.name || req.file.originalname
    ).trim();

    const category = String(
      req.body.category || "General"
    ).trim();

    if (
      !name ||
      name.length > 180 ||
      !category ||
      category.length > 80
    ) {
      return res.status(400).json({
        error: "Invalid name or category."
      });
    }

    const allowedTypes = new Set([
      "application/pdf",
      "text/plain",
      "image/png",
      "image/jpeg"
    ]);

    if (!allowedTypes.has(req.file.mimetype)) {
      return res.status(400).json({
        error: "Unsupported file type."
      });
    }

    const id = randomUUID();
    const storageKey = randomUUID();
    const filePath = path.join(uploadDir, storageKey);

    const sha256 = createHash("sha256")
      .update(req.file.buffer)
      .digest("hex");

    try {
      fs.writeFileSync(filePath, req.file.buffer, {
        flag: "wx"
      });

      db.prepare(`
        INSERT INTO documents (
          id,
          owner_id,
          name,
          category,
          mime_type,
          size,
          storage_key,
          sha256
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        req.user.id,
        name,
        category,
        req.file.mimetype,
        req.file.size,
        storageKey,
        sha256
      );

      audit({
        actorId: req.user.id,
        action: "upload",
        documentId: id,
        outcome: "success",
        details: {
          name,
          size: req.file.size,
          sha256
        }
      });

      res.status(201).json({
        documentId: id,
        name,
        category
      });
    } catch {
      try {
        fs.unlinkSync(filePath);
      } catch {}

      res.status(500).json({
        error: "Could not save document."
      });
    }
  }
);

// Download a document.
router.get(
  "/:id/download",
  requireUser,
  requireDocumentAccess("read"),
  (req, res) => {
    const filePath = path.join(
      uploadDir,
      req.document.storage_key
    );

    if (!fs.existsSync(filePath)) {
      audit({
        actorId: req.user.id,
        action: "download",
        documentId: req.document.id,
        outcome: "failure"
      });

      return res.status(404).json({
        error: "Document file unavailable."
      });
    }

    audit({
      actorId: req.user.id,
      action: "download",
      documentId: req.document.id,
      outcome: "success"
    });

    res.download(filePath, req.document.name);
  }
);

// Rename a document.
router.patch(
  "/:id",
  requireUser,
  requireDocumentAccess("edit"),
  (req, res) => {
    const name = typeof req.body.name === "string"
      ? req.body.name.trim()
      : "";

    if (!name || name.length > 180) {
      return res.status(400).json({
        error: "Invalid document name."
      });
    }

    db.prepare(`
      UPDATE documents
      SET name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL
    `).run(name, req.document.id);

    audit({
      actorId: req.user.id,
      action: "change",
      documentId: req.document.id,
      outcome: "success",
      details: { name }
    });

    res.json({ success: true, name });
  }
);

// Soft-delete a document. Only the owner or admin may do this.
router.delete(
  "/:id",
  requireUser,
  requireDocumentAccess("edit"),
  (req, res) => {
    if (
      !["owner", "admin"].includes(
        req.document.access_level
      )
    ) {
      return res.status(403).json({
        error: "Only the owner or admin may delete."
      });
    }

    db.prepare(`
      UPDATE documents
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL
    `).run(req.document.id);

    audit({
      actorId: req.user.id,
      action: "delete",
      documentId: req.document.id,
      outcome: "success"
    });

    res.status(204).end();
  }
);

/* List users who have access to a document.
   Only the owner or admin may view its sharing permissions. */
router.get("/:id/grants", requireUser, (req, res) => {
  const document = db.prepare(`
    SELECT id, owner_id
    FROM documents
    WHERE id = ? AND deleted_at IS NULL
  `).get(req.params.id);

  if (!document) {
    return res.status(404).json({
      error: "Document not found."
    });
  }

  if (
    document.owner_id !== req.user.id &&
    req.user.role !== "admin"
  ) {
    return res.status(403).json({
      error: "Only the owner or admin can view permissions."
    });
  }

  const grants = db.prepare(`
    SELECT
      g.user_id AS userId,
      u.name,
      u.email,
      g.permission,
      g.granted_by AS grantedBy,
      g.created_at AS createdAt
    FROM grants g
    JOIN users u ON u.id = g.user_id
    WHERE g.document_id = ?
      AND u.disabled = 0
    ORDER BY g.created_at DESC
  `).all(document.id);

  res.json({ grants });
});

/* Grant or update read/edit access to a named user.
   Only the owner or admin can manage grants. */
router.put("/:id/grants/:userId", requireUser, (req, res) => {
  const document = db.prepare(`
    SELECT id, owner_id
    FROM documents
    WHERE id = ? AND deleted_at IS NULL
  `).get(req.params.id);

  if (!document) {
    audit({
      actorId: req.user.id,
      action: "grant_permission",
      documentId: req.params.id,
      targetUserId: req.params.userId,
      outcome: "denied"
    });

    return res.status(404).json({
      error: "Document not found."
    });
  }

  if (
    document.owner_id !== req.user.id &&
    req.user.role !== "admin"
  ) {
    audit({
      actorId: req.user.id,
      action: "grant_permission",
      documentId: document.id,
      targetUserId: req.params.userId,
      outcome: "denied"
    });

    return res.status(403).json({
      error: "Only the owner or admin can manage permissions."
    });
  }

  const permission = req.body?.permission;

  if (!["read", "edit"].includes(permission)) {
    return res.status(400).json({
      error: "Permission must be read or edit."
    });
  }

  const target = db.prepare(`
    SELECT id, role, disabled
    FROM users
    WHERE id = ?
  `).get(req.params.userId);

  if (
    !target ||
    target.disabled ||
    target.id === document.owner_id
  ) {
    return res.status(400).json({
      error: "Invalid target user."
    });
  }

  try {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO grants (
          document_id,
          user_id,
          permission,
          granted_by
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(document_id, user_id)
        DO UPDATE SET
          permission = excluded.permission,
          granted_by = excluded.granted_by,
          created_at = CURRENT_TIMESTAMP
      `).run(
        document.id,
        target.id,
        permission,
        req.user.id
      );

      audit({
        actorId: req.user.id,
        action: "grant_permission",
        documentId: document.id,
        targetUserId: target.id,
        outcome: "success",
        details: { permission }
      });
    })();

    res.json({
      success: true,
      documentId: document.id,
      userId: target.id,
      permission
    });
  } catch {
    res.status(500).json({
      error: "Could not update permission."
    });
  }
});

/* Revoke a user's access for subsequent requests. */
router.delete(
  "/:id/grants/:userId",
  requireUser,
  (req, res) => {
    const document = db.prepare(`
      SELECT id, owner_id
      FROM documents
      WHERE id = ? AND deleted_at IS NULL
    `).get(req.params.id);

    if (!document) {
      audit({
        actorId: req.user.id,
        action: "revoke_permission",
        documentId: req.params.id,
        targetUserId: req.params.userId,
        outcome: "denied"
      });

      return res.status(404).json({
        error: "Document not found."
      });
    }

    if (
      document.owner_id !== req.user.id &&
      req.user.role !== "admin"
    ) {
      audit({
        actorId: req.user.id,
        action: "revoke_permission",
        documentId: document.id,
        targetUserId: req.params.userId,
        outcome: "denied"
      });

      return res.status(403).json({
        error: "Only the owner or admin can manage permissions."
      });
    }

    try {
      db.transaction(() => {
        const result = db.prepare(`
          DELETE FROM grants
          WHERE document_id = ? AND user_id = ?
        `).run(document.id, req.params.userId);

        audit({
          actorId: req.user.id,
          action: "revoke_permission",
          documentId: document.id,
          targetUserId: req.params.userId,
          outcome: "success",
          details: {
            removed: result.changes > 0
          }
        });
      })();

      res.json({
        success: true,
        revoked: true
      });
    } catch {
      res.status(500).json({
        error: "Could not revoke permission."
      });
    }
  }
);

export default router;
