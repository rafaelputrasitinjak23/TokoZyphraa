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
  const gradient = context.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(79, 70, 229, 0.34)');
  gradient.addColorStop(1, 'rgba(79, 70, 229, 0.03)');

  const rupiah = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  });

  const compactNumber = new Intl.NumberFormat('id-ID', {
    notation: 'compact',
    maximumFractionDigits: 1
  });

  const revenues = rows.map((row) => Number(row.revenue || 0));
  const orderCounts = rows.map((row) => Number(row.orders || 0));
  const useBars = rows.length <= 31;

  const dataset = useBars
    ? {
        label: 'Omzet',
        data: revenues,
        backgroundColor: gradient,
        borderColor: '#4f46e5',
        borderWidth: 1.5,
        borderRadius: 7,
        borderSkipped: false,
        maxBarThickness: 18,
        hoverBackgroundColor: 'rgba(79, 70, 229, 0.72)'
      }
    : {
        label: 'Omzet',
        data: revenues,
        borderColor: '#4f46e5',
        backgroundColor: gradient,
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#4f46e5',
        pointBorderWidth: 2,
        fill: true,
        tension: 0.28
      };

  new window.Chart(context, {
    type: useBars ? 'bar' : 'line',
    data: {
      labels: rows.map((row) => row.label),
      datasets: [dataset]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 100,
      interaction: {
        mode: 'index',
        intersect: false
      },
      animation: {
        duration: 550
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
          offset: useBars,
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: '#64748b',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: window.innerWidth <= 480 ? 4 : 8,
            font: { size: window.innerWidth <= 480 ? 9 : 11 }
          }
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: 'rgba(148, 163, 184, 0.18)' },
          ticks: {
            color: '#64748b',
            padding: 7,
            maxTicksLimit: 6,
            callback(value) {
              return `Rp${compactNumber.format(Number(value || 0))}`;
            },
            font: { size: window.innerWidth <= 480 ? 9 : 11 }
          }
        }
      }
    }
  });
})();
