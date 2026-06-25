function verifyPakasirTransaction(transaction, reference, amount, { requireCompleted = false } = {}) {
  const valid = Boolean(transaction) &&
    transaction.order_id === reference &&
    Number(transaction.amount) === Number(amount) &&
    transaction.project === process.env.PAKASIR_PROJECT_SLUG;
  if (!valid) return false;
  return !requireCompleted || transaction.status === 'completed';
}

function pakasirCompletedAt(transaction, fallback = new Date()) {
  if (!transaction?.completed_at) return fallback;
  const completedAt = new Date(transaction.completed_at);
  return Number.isNaN(completedAt.getTime()) ? fallback : completedAt;
}

module.exports = { verifyPakasirTransaction, pakasirCompletedAt };
