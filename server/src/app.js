
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import session from "express-session";
import connectSqlite3 from "connect-sqlite3";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import cors from "cors";
import auditRouter from "./audit.js";

import { db, STORAGE_DIR } from "./db.js";
import documentsRouter from "./documents.js";

// Validate the session secret before starting the application.
if (
  !process.env.SESSION_SECRET ||
  process.env.SESSION_SECRET.length < 32
) {
  throw new Error(
    "SESSION_SECRET must be at least 32 characters."
  );
}

const app = express();
const SQLiteStore = connectSqlite3(session);

app.disable("x-powered-by");

// Allow requests from the local React/Vite frontend.
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS"
    ],
    allowedHeaders: ["Content-Type"]
  })
);

app.use(helmet());
app.use(express.json({ limit: "100kb" }));

// Persistent server-side sessions.
app.use(
  session({
    name: "trustvault.sid",
    secret: process.env.SESSION_SECRET,
    store: new SQLiteStore({
      db: "sessions.db",
      dir: STORAGE_DIR
    }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 60 * 1000
    }
  })
);

// Limit repeated login attempts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

// Health check.
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "TrustVault API",
    database: db.open
  });
});

// Login.
app.post(
  "/api/auth/login",
  loginLimiter,
  async (req, res, next) => {
    try {
      const email =
        typeof req.body?.email === "string"
          ? req.body.email.trim().toLowerCase()
          : "";

      const password =
        typeof req.body?.password === "string"
          ? req.body.password
          : "";

      if (
        !email ||
        !password ||
        email.length > 254 ||
        password.length > 200
      ) {
        return res.status(400).json({
          error: "Invalid email or password."
        });
      }

      const user = db
        .prepare(`
          SELECT
            id,
            name,
            email,
            password_hash,
            role,
            disabled
          FROM users
          WHERE email = ?
        `)
        .get(email);

      const passwordOk = user
        ? await bcrypt.compare(
            password,
            user.password_hash
          )
        : false;

      if (!user || !passwordOk || user.disabled) {
        return res.status(401).json({
          error: "Invalid email or password."
        });
      }

      // Regenerate the session to prevent session fixation.
      req.session.regenerate((err) => {
        if (err) return next(err);

        req.session.userId = user.id;

        req.session.save((saveErr) => {
          if (saveErr) return next(saveErr);

          res.json({
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role
            }
          });
        });
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get the currently authenticated user.
app.get("/api/auth/me", (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  const user = db
    .prepare(`
      SELECT id, name, email, role
      FROM users
      WHERE id = ? AND disabled = 0
    `)
    .get(req.session.userId);

  if (!user) {
    return req.session.destroy(() => {
      res.status(401).json({
        error: "Authentication required."
      });
    });
  }

  res.json({ user });
});

// Logout.
app.post("/api/auth/logout", (req, res, next) => {
  if (!req.session) {
    return res.status(204).end();
  }

  req.session.destroy((err) => {
    if (err) return next(err);

    res.clearCookie("trustvault.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax"
    });

    res.status(204).end();
  });
});

/*
 * List active users for document sharing.
 * Requires an authenticated session.
 * Excludes the currently signed-in user.
 */
app.get("/api/users", (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  const currentUser = db
    .prepare(`
      SELECT id, disabled
      FROM users
      WHERE id = ?
    `)
    .get(req.session.userId);

  if (!currentUser || currentUser.disabled) {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  const users = db
    .prepare(`
      SELECT id, name, email, role
      FROM users
      WHERE disabled = 0
        AND id != ?
      ORDER BY name COLLATE NOCASE
    `)
    .all(currentUser.id);

  res.json({ users });
});

/*
 * Admin-only audit activity endpoint.
 * Returns the latest 200 recorded audit events.
 */
app.get("/api/audit", (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  const currentUser = db
    .prepare(`
      SELECT id, role, disabled
      FROM users
      WHERE id = ?
    `)
    .get(req.session.userId);

  if (!currentUser || currentUser.disabled) {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  if (currentUser.role !== "admin") {
    return res.status(403).json({
      error: "Administrator access required."
    });
  }

  try {
    const logs = db
      .prepare(`
        SELECT
          a.id,
          a.actor_id AS actorId,
          u.name AS actorName,
          u.email AS actorEmail,
          a.action,
          a.document_id AS documentId,
          d.name AS documentName,
          a.target_user_id AS targetUserId,
          a.outcome,
          a.details_json AS details,
          a.created_at AS createdAt,
          a.previous_hash AS previousHash,
          a.event_hash AS eventHash,
          a.event_payload AS eventPayload
        FROM audit_events a
        LEFT JOIN users u
          ON u.id = a.actor_id
        LEFT JOIN documents d
          ON d.id = a.document_id
        ORDER BY a.id DESC
        LIMIT 200
      `)
      .all();

    return res.json({ logs });
  } catch (error) {
    console.error(
      "Could not load audit logs:",
      error.message
    );

    return res.status(500).json({
      error: "Could not load audit logs."
    });
  }
});

// Document listing, uploads, downloads, editing,
// deletion and permission management.
app.use("/api/documents", documentsRouter);
app.use("/api/audit", auditRouter);
// Do not expose internal error details to clients.
app.use((err, _req, res, _next) => {
  console.error(
    "TrustVault API error:",
    err.message
  );

  if (res.headersSent) return;

  res.status(500).json({
    error: "Internal server error."
  });
});

const PORT = Number(process.env.PORT) || 4000;

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(
      `TrustVault API running at http://localhost:${PORT}`
    );
  });
}

export default app;
