const { MongoClient } = require("mongodb");

let db = null;

async function connectDb() {
  const client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  db = client.db(process.env.DB_NAME);

  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("users").createIndex({ user_id: 1 }, { unique: true });
  await db.collection("user_sessions").createIndex({ session_token: 1 });

  return db;
}

function getDb() {
  if (!db) throw new Error("Database not initialised. Call connectDb() first.");
  return db;
}

module.exports = { connectDb, getDb };
