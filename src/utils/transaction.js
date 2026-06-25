const mongoose = require('mongoose');

function isTransactionUnsupported(error) {
  const message = String(error?.message || '');
  return message.includes('Transaction numbers are only allowed on a replica set member or mongos') ||
    message.includes('Transaction support is not available') ||
    error?.code === 20;
}

async function withMongoTransaction(work) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await work(session);
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary'
    });
    return result;
  } catch (error) {
    if (isTransactionUnsupported(error)) {
      const transactionError = new Error('MongoDB harus menggunakan replica set atau mongos agar transaksi finansial dapat diproses dengan aman.');
      transactionError.status = 503;
      transactionError.code = 'MONGODB_TRANSACTIONS_REQUIRED';
      throw transactionError;
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = { withMongoTransaction, isTransactionUnsupported };
