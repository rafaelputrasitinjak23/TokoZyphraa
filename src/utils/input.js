function parseInteger(value, { name = 'Nilai', min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, nullable = false } = {}) {
  if (nullable && (value == null || value === '')) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    const error = new Error(`${name} harus berupa bilangan bulat antara ${min} dan ${max}.`);
    error.status = 400;
    throw error;
  }
  return number;
}

function parseDate(value, { name = 'Tanggal', nullable = false } = {}) {
  if (nullable && (value == null || value === '')) return null;
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    const error = new Error(`${name} tidak valid.`);
    error.status = 400;
    throw error;
  }
  return date;
}

function parsePage(value) {
  const page = Number(value || 1);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function checkbox(value) {
  return value === 'on' || value === 'true' || value === '1';
}

module.exports = { parseInteger, parseDate, parsePage, checkbox };
