
import "dotenv/config";
import { pool, query } from "./postgres.js";

// PostgreSQL database connection shared across the backend.
export { pool, query };

// Check the database connection when the application starts.
export async function initializeDatabase() {
  const client = await pool.connect();

  try {
    await client.query("SELECT 1");
    console.log("TrustVault PostgreSQL database connected successfully.");
  } catch (error) {
    console.error("PostgreSQL connection failed:", error.message);
    throw error;
  } finally {
    client.release();
  }
}
