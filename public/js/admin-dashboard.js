(() => {
  const canvas = document.getElementById('sales-chart');
  const dataElement = document.getElementById('sales-chart-data');
  if (!canvas || !dataElement || typeof window.Chart !== 'function') return;

  let rows;
  try {
    rows = JSON.parse(dataElement.textContent || '[]');
  } catch (_) {
    return;
  }
  if (!Array.isArray(rows) || rows.length === 0) return;

  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, 320);
  gradient.addColorStop(0, 'rgba(79, 70, 229, 0.30)');
  gradient.addColorStop(1, 'rgba(79, 70, 229, 0.01)');

  const rupiah = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  });

  const compactNumber = new Intl.NumberFormat('id-ID', {
    notation: 'compact',
    maximumFractionDigits: 1
  });

  const orderCounts = rows.map((row) => Number(row.orders || 0));

  new window.Chart(context, {
    type: 'line',
    data: {
      labels: rows.map((row) => row.label),
      datasets: [{
        label: 'Omzet',
        data: rows.map((row) => Number(row.revenue || 0)),
        borderColor: '#4f46e5',
        backgroundColor: gradient,
        borderWidth: 2.5,
        pointRadius: rows.length <= 14 ? 3 : 0,
        pointHoverRadius: 5,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#4f46e5',
        pointBorderWidth: 2,
        fill: true,
        tension: 0.32
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 120,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          padding: 12,
          callbacks: {
            title(items) {
              const row = rows[items[0]?.dataIndex];
              return row?.date || '';
            },
            label(item) {
              return `Omzet: ${rupiah.format(item.parsed.y || 0)}`;
            },
            afterLabel(item) {
              const total = orderCounts[item.dataIndex] || 0;
              return `${total} pesanan selesai`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: '#64748b',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: window.innerWidth <= 560 ? 5 : 10,
            font: { size: 11 }
          }
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: 'rgba(148, 163, 184, 0.18)' },
          ticks: {
            color: '#64748b',
            padding: 8,
            callback(value) {
              return `Rp${compactNumber.format(Number(value || 0))}`;
            },
            font: { size: 11 }
          }
        }
      }
    }
  });
})();
