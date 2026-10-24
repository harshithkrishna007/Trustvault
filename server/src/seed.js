
import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";

const demoUsers = [
  ["TrustVault Admin", "admin@trustvault.demo", process.env.DEMO_ADMIN_PASSWORD, "admin"],
  ["Alice Owner", "alice@trustvault.demo", process.env.DEMO_OWNER_PASSWORD, "owner"],
  ["Bob Viewer", "bob@trustvault.demo", process.env.DEMO_VIEWER_PASSWORD, "viewer"]
];

try {
  const prepared = [];

  for (const [name, email, password, role] of demoUsers) {
    if (!password || password.length < 12) {
      throw new Error(`Set a strong password for ${email} in server/.env`);
    }

    prepared.push({
      name,
      email,
      role,
      passwordHash: await bcrypt.hash(password, 12)
    });
  }

  const insert = db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `);

  const update = db.prepare(`
    UPDATE users
    SET name = ?, password_hash = ?, role = ?, disabled = 0
    WHERE email = ?
  `);

  const seed = db.transaction((users) => {
    for (const user of users) {
      const existing = db.prepare(
        "SELECT id FROM users WHERE email = ?"
      ).get(user.email);

      if (existing) {
        update.run(
          user.name, user.passwordHash, user.role, user.email
        );
      } else {
        insert.run(
          randomUUID(),
          user.name,
          user.email,
          user.passwordHash,
          user.role
        );
      }
    }
  });

  seed(prepared);
  console.log("TrustVault demo users seeded successfully.");
} catch (error) {
  console.error("Failed to seed demo users:", error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
