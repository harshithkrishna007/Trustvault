
import "dotenv/config";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { pool } from "./postgres.js";
import { initializeDatabase } from "./db.js";
import documentsRouter from "./documents.js";
import auditRouter from "./audit.js";
import { audit } from "./security.js";

const app = express();
const PgSession = connectPgSimple(session);

const isProduction = process.env.NODE_ENV === "production";
const frontendUrl = (
  process.env.FRONTEND_URL || "http://localhost:5173"
).replace(/\/+$/, "");

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be at least 32 characters long.");
}

app.set("trust proxy", isProduction ? 1 : false);

app.use(helmet());

app.use(cors({
  origin: frontendUrl,
  credentials: true
}));

app.use(express.json({ limit: "100kb" }));

app.use(session({
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),
  name: "trustvault.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: 30 * 60 * 1000,
    path: "/"
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." }
});

function requireLogin(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Authentication required." });
  }
  next();
}

async function getActiveUser(userId) {
  const result = await pool.query(
    `SELECT id, name, email, role, disabled, created_at
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );

  const user = result.rows[0];
  return user && !user.disabled ? user : null;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    created_at: user.created_at
  };
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

// Login
app.post("/api/auth/login", loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const result = await pool.query(
      `SELECT id, name, email, password_hash, role, disabled, created_at
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [email.trim().toLowerCase()]
    );

    const user = result.rows[0];

    if (
      !user ||
      user.disabled ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      if (user) {
        await audit({
          actorId: user.id,
          action: "login",
          outcome: "denied",
          details: { reason: "Invalid credentials or disabled account" }
        });
      }

      return res.status(401).json({ error: "Invalid email or password." });
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate(error => error ? reject(error) : resolve());
    });

    req.session.userId = user.id;

    await new Promise((resolve, reject) => {
      req.session.save(error => error ? reject(error) : resolve());
    });

    await audit({
      actorId: user.id,
      action: "login",
      outcome: "success"
    });

    return res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

// Current session
app.get("/api/auth/me", requireLogin, async (req, res, next) => {
  try {
    const user = await getActiveUser(req.session.userId);

    if (!user) {
      return req.session.destroy(() => {
        res.clearCookie("trustvault.sid", { path: "/" });
        res.status(401).json({ error: "Authentication required." });
      });
    }

    return res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

// Logout
app.post("/api/auth/logout", requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.userId;

    await new Promise((resolve, reject) => {
      req.session.destroy(error => error ? reject(error) : resolve());
    });

    res.clearCookie("trustvault.sid", {
      path: "/",
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax"
    });

    await audit({
      actorId: userId,
      action: "logout",
      outcome: "success"
    });

    return res.json({ message: "Logged out successfully." });
  } catch (error) {
    next(error);
  }
});

// List users (admin only)
app.get("/api/users", requireLogin, async (req, res, next) => {
  try {
    const currentUser = await getActiveUser(req.session.userId);

    if (!currentUser) {
      return res.status(401).json({ error: "Authentication required." });
    }

    if (currentUser.role !== "admin") {
      return res.status(403).json({ error: "Admin access required." });
    }

    const result = await pool.query(
      `SELECT id, name, email, role, disabled, created_at
       FROM users
       ORDER BY created_at DESC`
    );

    return res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Mount API routers
app.use("/api/documents", documentsRouter);
app.use("/api/audit", auditRouter);

// Handle unknown API routes
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found." });
});

// Central error handler
app.use((error, req, res, next) => {
  console.error("API error:", error.message);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    error: "An unexpected server error occurred."
  });
});

const port = Number(process.env.PORT) || 3000;

async function startServer() {
  await initializeDatabase();

  app.listen(port, "0.0.0.0", () => {
    console.log(`TrustVault API listening on port ${port}`);
  });
}

startServer().catch(error => {
  console.error("Failed to start TrustVault:", error.message);
  process.exit(1);
});

export default app;
