import "server-only";
import mongoose from "mongoose";

/**
 * Cached MongoDB connection.
 *
 * Next.js reloads modules in development and runs many concurrent lambdas in
 * production, so the connection promise is memoised on `globalThis` to avoid
 * opening a new pool per request (§7).
 */

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/aplus_learn";

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is not set. Copy .env.example to .env.local.");
}

mongoose.set("strictQuery", true);

const globalForMongoose = globalThis;
const cache = globalForMongoose.__aplusMongoose ?? { conn: null, promise: null };
globalForMongoose.__aplusMongoose = cache;

export async function connectToDatabase() {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(MONGODB_URI, {
        bufferCommands: false,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 8000,
        autoIndex: process.env.NODE_ENV !== "production",
      })
      .then((m) => m.connection);
  }

  try {
    cache.conn = await cache.promise;
  } catch (error) {
    // Allow the next request to retry rather than caching a rejected promise.
    cache.promise = null;
    throw error;
  }

  return cache.conn;
}

/** Health probe used by the admin dashboard and the QA script. */
export async function databaseStatus() {
  try {
    const conn = await connectToDatabase();
    await conn.db.admin().ping();
    return { connected: true, name: conn.name, host: conn.host };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

export { mongoose };
