const BASE_URL = 'https://app.pakasir.com';
const REQUEST_TIMEOUT_MS = 15000;

function assertConfigured() {
  if (!process.env.PAKASIR_PROJECT_SLUG || !process.env.PAKASIR_API_KEY) {
    throw new Error('PAKASIR_PROJECT_SLUG dan PAKASIR_API_KEY belum dikonfigurasi.');
  }
}

async function parseResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || fallbackMessage);
    error.status = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw error;
  }
  return data;
}

async function createTransaction({ orderId, amount, method }) {
  assertConfigured();
  if (!orderId || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('Data transaksi pembayaran tidak valid.');
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
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const data = await parseResponse(response, 'Pakasir gagal membuat transaksi pembayaran.');
  if (!data.payment) throw new Error(data.message || 'Respons pembuatan pembayaran Pakasir tidak lengkap.');
  return data.payment;
}

async function getTransactionDetail({ orderId, amount }) {
  assertConfigured();
  if (!orderId || !Number.isSafeInteger(Number(amount)) || Number(amount) <= 0) throw new Error('Data verifikasi pembayaran tidak valid.');
  const params = new URLSearchParams({
    project: process.env.PAKASIR_PROJECT_SLUG,
    amount: String(amount),
    order_id: orderId,
    api_key: process.env.PAKASIR_API_KEY
  });
  const response = await fetch(`${BASE_URL}/api/transactiondetail?${params}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const data = await parseResponse(response, 'Status transaksi Pakasir tidak dapat diverifikasi.');
  if (!data.transaction) throw new Error(data.message || 'Respons detail transaksi Pakasir tidak lengkap.');
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
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  return parseResponse(response, 'Transaksi Pakasir tidak dapat dibatalkan.');
}

module.exports = { createTransaction, getTransactionDetail, cancelTransaction };
