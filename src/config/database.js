const mongoose = require('mongoose');

let cached = global.__mongooseConnection;
if (!cached) {
  cached = global.__mongooseConnection = { connection: null, promise: null, transactionSupportChecked: false };
}

async function assertTransactionSupport(connection) {
  if (cached.transactionSupportChecked || process.env.REQUIRE_MONGODB_TRANSACTIONS === 'false') return;
  const hello = await connection.connection.db.admin().command({ hello: 1 });
  const supportsTransactions = Boolean(hello.setName || hello.msg === 'isdbgrid');
  if (!supportsTransactions) {
    throw new Error('MongoDB harus berjalan sebagai replica set atau mongos. Transaksi finansial tidak aman pada standalone MongoDB.');
  }
  cached.transactionSupportChecked = true;
}

async function connectDatabase() {
  if (cached.connection) {
    await assertTransactionSupport(cached.connection);
    return cached.connection;
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI belum dikonfigurasi.');

  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI, {
      bufferCommands: false,
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 60000,
      serverSelectionTimeoutMS: 10000,
      retryWrites: true,
      w: 'majority'
    });
  }

  try {
    cached.connection = await cached.promise;
    await assertTransactionSupport(cached.connection);
    return cached.connection;
  } catch (error) {
    cached.promise = null;
    cached.connection = null;
    throw error;
  }
}

module.exports = connectDatabase;
