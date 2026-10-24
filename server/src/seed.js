
import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { pool } from "./postgres.js";

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
      id: randomUUID(),
      name,
      email,
      role,
      passwordHash: await bcrypt.hash(password, 12)
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const user of prepared) {
      const existing = await client.query(
        "SELECT id FROM users WHERE email = $1",
        [user.email]
      );

      if (existing.rowCount > 0) {
        await client.query(
          `UPDATE users
           SET name = $1, password_hash = $2, role = $3, disabled = FALSE
           WHERE email = $4`,
          [user.name, user.passwordHash, user.role, user.email]
        );
      } else {
        await client.query(
          `INSERT INTO users (id, name, email, password_hash, role)
           VALUES ($1, $2, $3, $4, $5)`,
          [user.id, user.name, user.email, user.passwordHash, user.role]
        );
      }
    }

    await client.query("COMMIT");
    console.log("TrustVault demo users seeded successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error("Failed to seed demo users:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
