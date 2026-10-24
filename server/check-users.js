
import { db } from "./src/db.js";

const users = db.prepare(
  "SELECT id, name, email, role FROM users"
).all();

console.table(users);
