const mongoose = require('mongoose');

let cached = global.__mongooseConnection;
if (!cached) {
  cached = global.__mongooseConnection = { connection: null, promise: null };
}

async function connectDatabase() {
  if (cached.connection) return cached.connection;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI belum dikonfigurasi.');

  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI, {
      bufferCommands: false,
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 60000,
      serverSelectionTimeoutMS: 10000
    });
  }

  try {
    cached.connection = await cached.promise;
    return cached.connection;
  } catch (error) {
    cached.promise = null;
    throw error;
  }
}

module.exports = connectDatabase;
