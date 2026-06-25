const { reconcilePayments } = require('./reconcilePayments');

let timer;
let running = false;

function startScheduler(intervalMinutes) {
  if (timer) return timer;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await reconcilePayments();
      if (result.errors) console.error('Rekonsiliasi pembayaran selesai dengan error:', result);
    } catch (error) {
      console.error('Rekonsiliasi pembayaran gagal:', error);
    } finally {
      running = false;
    }
  };
  timer = setInterval(run, intervalMinutes * 60 * 1000);
  timer.unref();
  setImmediate(run);
  return timer;
}

module.exports = { startScheduler };
