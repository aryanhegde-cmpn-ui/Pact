import 'server-only';

import mongoose, { type Mongoose } from 'mongoose';

import { env } from '@/lib/env';

interface MongooseCache {
  conn: Mongoose | null;
  promise: Promise<Mongoose> | null;
}

/**
 * Every serverless invocation gets a fresh module scope but may reuse the same
 * container, so the cache has to live on `globalThis` to outlive the module.
 * The same trick keeps the connection alive across Fast Refresh in development,
 * where re-evaluating this file would otherwise open a new pool on every save.
 *
 * Atlas M0 caps the cluster at 500 connections. Connecting per invocation
 * exhausts that pool almost immediately -- hence this file.
 */
const globalForMongoose = globalThis as typeof globalThis & {
  __pactMongooseCache?: MongooseCache;
};

const cache: MongooseCache = (globalForMongoose.__pactMongooseCache ??= {
  conn: null,
  promise: null,
});

/**
 * Returns the shared Mongoose connection, opening it only on the first call.
 * Concurrent callers await the same in-flight promise rather than racing to
 * open competing connections.
 */
export async function connectToDatabase(): Promise<Mongoose> {
  if (cache.conn) {
    return cache.conn;
  }

  if (!cache.promise) {
    cache.promise = mongoose.connect(env.MONGODB_URI, {
      // Fail fast instead of silently queueing operations against a dead socket;
      // a serverless function has no time to spend waiting.
      bufferCommands: false,
      // Small pool: many concurrent lambdas share one M0 cluster.
      maxPoolSize: 5,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 8_000,
      socketTimeoutMS: 20_000,
    });
  }

  try {
    cache.conn = await cache.promise;
  } catch (error) {
    // Drop the rejected promise so the next request can retry rather than
    // replaying the same failure for the life of the container.
    cache.promise = null;
    throw error;
  }

  return cache.conn;
}

/**
 * Test-only escape hatch. Production code must never call this -- dropping the
 * cache mid-flight is exactly the behaviour this module exists to prevent.
 */
export function __resetConnectionCacheForTests(): void {
  cache.conn = null;
  cache.promise = null;
}
