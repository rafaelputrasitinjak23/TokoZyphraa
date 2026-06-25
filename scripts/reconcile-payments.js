require('dotenv').config();
const { validateEnvironment } = require('../src/config/env');
const connectDatabase = require('../src/config/database');
const { reconcilePayments } = require('../src/jobs/reconcilePayments');

async function run() {
  validateEnvironment();
  await connectDatabase();
  const result = await reconcilePayments({ limit: 500 });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.errors ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
