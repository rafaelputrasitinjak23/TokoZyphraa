const BASE_URL = 'https://app.pakasir.com';

function assertConfigured() {
  if (!process.env.PAKASIR_PROJECT_SLUG || !process.env.PAKASIR_API_KEY) {
    throw new Error('PAKASIR_PROJECT_SLUG dan PAKASIR_API_KEY belum dikonfigurasi.');
  }
}

async function createTransaction({ orderId, amount, method }) {
  assertConfigured();
  const paymentMethod = method || process.env.PAKASIR_DEFAULT_METHOD || 'qris';
  const response = await fetch(`${BASE_URL}/api/transactioncreate/${encodeURIComponent(paymentMethod)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      project: process.env.PAKASIR_PROJECT_SLUG,
      order_id: orderId,
      amount,
      api_key: process.env.PAKASIR_API_KEY
    }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.payment) {
    throw new Error(data.message || 'Pakasir gagal membuat transaksi pembayaran.');
  }
  return data.payment;
}

async function getTransactionDetail({ orderId, amount }) {
  assertConfigured();
  const params = new URLSearchParams({
    project: process.env.PAKASIR_PROJECT_SLUG,
    amount: String(amount),
    order_id: orderId,
    api_key: process.env.PAKASIR_API_KEY
  });
  const response = await fetch(`${BASE_URL}/api/transactiondetail?${params}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.transaction) {
    throw new Error(data.message || 'Status transaksi Pakasir tidak dapat diverifikasi.');
  }
  return data.transaction;
}


async function cancelTransaction({ orderId, amount }) {
  assertConfigured();
  const response = await fetch(`${BASE_URL}/api/transactioncancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      project: process.env.PAKASIR_PROJECT_SLUG,
      order_id: orderId,
      amount,
      api_key: process.env.PAKASIR_API_KEY
    }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Transaksi Pakasir tidak dapat dibatalkan.');
  return data;
}

module.exports = { createTransaction, getTransactionDetail, cancelTransaction };
