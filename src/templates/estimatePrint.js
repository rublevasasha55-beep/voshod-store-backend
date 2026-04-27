// ─── Константы ────────────────────────────────────────────────────────────────

const UNIT_LABELS = {
  PCS:   'шт',
  BAG:   'меш',
  SQ_M:  'м²',
  CU_M:  'м³',
  PACK:  'уп',
  ROLL:  'рул',
  LIN_M: 'пог. м',
};

// ─── Хелперы ──────────────────────────────────────────────────────────────────

// Экранирует HTML-спецсимволы для безопасной вставки данных из БД
function e(val) {
  if (val == null) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(val) {
  return Number(val).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' ₽';
}

function formatWeight(kg) {
  if (!kg || kg === 0) return '—';
  return Number(kg).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' кг';
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// ─── Главная функция-генератор ────────────────────────────────────────────────

/**
 * Генерирует HTML строку для печатной формы сметы.
 *
 * @param {Object} params
 * @param {import('@prisma/client').Estimate & { user, items: Array<{product}> }} params.estimate
 * @param {number}  params.totalWeight   — суммарный вес (кг)
 * @param {number}  params.totalPrice    — итоговая сумма (₽)
 * @param {number}  params.totalSavings  — экономия по скидкам (₽), 0 если нет
 * @param {string}  params.qrCodeDataUrl — base64 PNG data-URL QR-кода
 * @param {boolean} params.autoPrint     — true = запустить window.print() при загрузке
 */
export function generateEstimateHtml({
  estimate,
  totalWeight,
  totalPrice,
  totalSavings,
  qrCodeDataUrl,
  autoPrint = false,
}) {
  const todayStr        = formatDate(new Date());
  const estimateDateStr = formatDate(estimate.createdAt);
  const clientName      = estimate.user?.fullName || '—';
  const clientPhone     = estimate.user?.phone    || '';

  // Строки таблицы товаров
  const tableRows = estimate.items.map((item, idx) => {
    const p        = item.product;
    const rowPrice = Number(p.price) * item.quantity;
    const rowWeight = (p.weight ?? 0) * item.quantity;
    const thumb    = p.images?.[0] ?? '';
    const unit     = UNIT_LABELS[p.unit] ?? p.unit;
    const oldRowPrice = p.oldPrice ? Number(p.oldPrice) * item.quantity : null;

    return `
      <tr class="${idx % 2 === 0 ? 'row-even' : 'row-odd'}">
        <td class="col-num">${idx + 1}</td>
        <td class="col-thumb">
          ${thumb
            ? `<img src="${e(thumb)}" alt="" width="40" height="40" class="thumb" loading="lazy">`
            : `<div class="thumb-placeholder"></div>`
          }
        </td>
        <td class="col-name">
          <span class="product-name">${e(p.name)}</span>
          ${p.description ? `<br><span class="product-desc">${e(p.description.slice(0, 80))}${p.description.length > 80 ? '…' : ''}</span>` : ''}
        </td>
        <td class="col-sku">${e(p.sku ?? '—')}</td>
        <td class="col-unit">${e(unit)}</td>
        <td class="col-qty">${e(item.quantity)}</td>
        <td class="col-price">
          ${e(formatMoney(p.price))}
          ${oldRowPrice ? `<br><span class="old-price">${e(formatMoney(p.oldPrice))}</span>` : ''}
        </td>
        <td class="col-sum">
          <strong>${e(formatMoney(rowPrice))}</strong>
          ${oldRowPrice ? `<br><span class="old-price">${e(formatMoney(oldRowPrice))}</span>` : ''}
        </td>
        <td class="col-weight">${e(formatWeight(rowWeight))}</td>
      </tr>`;
  }).join('');

  const itemCount = estimate.items.length;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Смета №${estimate.id} — ${e(estimate.name)}</title>
  <style>
    /* ── Страница ──────────────────────────────────────────────────────────── */
    @page {
      size: A4 landscape;
      margin: 12mm 14mm;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 9.5pt;
      color: #1a1a2e;
      background: #fff;
      line-height: 1.4;
    }

    /* ── Шапка ─────────────────────────────────────────────────────────────── */
    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding-bottom: 10px;
      border-bottom: 2.5px solid #0D1F3C;
      margin-bottom: 10px;
      gap: 12px;
    }
    .header-logo {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .header-logo img {
      height: 48px;
      width: auto;
    }
    .logo-fallback {
      font-size: 22pt;
      font-weight: 900;
      letter-spacing: -1px;
      color: #0D1F3C;
    }
    .logo-fallback span {
      color: #C8A84B;
    }
    .header-center {
      flex: 1;
      text-align: center;
    }
    .doc-title {
      font-size: 14pt;
      font-weight: 700;
      color: #0D1F3C;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .doc-subtitle {
      font-size: 11pt;
      color: #4a4a6a;
      margin-top: 3px;
    }
    .header-qr {
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
    }
    .header-qr img {
      width: 80px;
      height: 80px;
    }
    .qr-label {
      font-size: 6.5pt;
      color: #888;
      text-align: center;
    }

    /* ── Мета-строка ───────────────────────────────────────────────────────── */
    .meta {
      display: flex;
      gap: 30px;
      font-size: 8.5pt;
      color: #555;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .meta strong { color: #0D1F3C; }

    /* ── Таблица ────────────────────────────────────────────────────────────── */
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    thead { display: table-header-group; }   /* повтор заголовка на каждой стр. */

    thead tr {
      background: #0D1F3C;
      color: #fff;
    }
    thead th {
      padding: 7px 6px;
      text-align: left;
      font-size: 8pt;
      font-weight: 700;
      border: 1px solid #1e3a5f;
      vertical-align: middle;
    }
    thead th.right { text-align: right; }
    thead th.center { text-align: center; }

    /* Ширины колонок */
    .col-num    { width: 30px; text-align: center; }
    .col-thumb  { width: 50px; text-align: center; }
    .col-name   { /* flex */ }
    .col-sku    { width: 72px; }
    .col-unit   { width: 44px; text-align: center; }
    .col-qty    { width: 44px; text-align: center; }
    .col-price  { width: 80px; text-align: right; }
    .col-sum    { width: 90px; text-align: right; }
    .col-weight { width: 66px; text-align: right; }

    tbody tr { page-break-inside: avoid; }
    .row-even { background: #f8f9fb; }
    .row-odd  { background: #fff; }

    tbody td {
      padding: 6px 6px;
      border: 1px solid #dde3ec;
      vertical-align: middle;
      font-size: 8.5pt;
    }

    .thumb {
      width: 40px;
      height: 40px;
      object-fit: cover;
      border-radius: 3px;
      border: 1px solid #e0e0e0;
      display: block;
      margin: 0 auto;
    }
    .thumb-placeholder {
      width: 40px;
      height: 40px;
      border-radius: 3px;
      border: 1px dashed #ccc;
      background: #f5f5f5;
      margin: 0 auto;
    }
    .product-name { font-weight: 600; }
    .product-desc { font-size: 7.5pt; color: #777; }
    .old-price    { font-size: 7.5pt; color: #aaa; text-decoration: line-through; }

    /* ── Итоговая строка ────────────────────────────────────────────────────── */
    tfoot tr { background: #f0f4f9; }
    tfoot td {
      padding: 8px 6px;
      border: 1.5px solid #b0c0d8;
      font-size: 9pt;
      font-weight: 700;
      vertical-align: middle;
    }
    .totals-label { color: #0D1F3C; }
    .totals-sum   { text-align: right; color: #0D1F3C; }
    .totals-weight { text-align: right; color: #0D1F3C; }

    /* ── Блок экономии ──────────────────────────────────────────────────────── */
    .savings-bar {
      margin-top: 8px;
      padding: 6px 10px;
      background: #e8f5e9;
      border-left: 3px solid #2e7d32;
      border-radius: 2px;
      font-size: 8.5pt;
      color: #1b5e20;
    }
    .savings-bar strong { font-size: 9.5pt; }

    /* ── Дисклеймер ─────────────────────────────────────────────────────────── */
    .disclaimer {
      margin-top: 12px;
      padding: 8px 10px;
      border-top: 1px solid #ccc;
      font-size: 7.5pt;
      color: #888;
      line-height: 1.5;
    }
    .disclaimer strong { color: #555; }

    /* ── Печать: скрыть лишнее ──────────────────────────────────────────────── */
    @media print {
      .no-print { display: none !important; }
      a { text-decoration: none; color: inherit; }
      body { font-size: 9pt; }
    }
    @media screen {
      body { max-width: 1100px; margin: 20px auto; padding: 20px; }
      .print-btn {
        position: fixed;
        top: 16px;
        right: 16px;
        padding: 10px 20px;
        background: #0D1F3C;
        color: #fff;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        cursor: pointer;
        z-index: 999;
      }
      .print-btn:hover { background: #1a3a6a; }
    }
  </style>
</head>
<body>

  ${!autoPrint ? '<button class="print-btn no-print" onclick="window.print()">🖨 Распечатать</button>' : ''}

  <!-- ── Шапка ─────────────────────────────────────────────────────────────── -->
  <div class="header">
    <div class="header-logo">
      <img src="/assets/logo.png" alt="Восход" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="logo-fallback" style="display:none">ВОС<span>ХОД</span></div>
    </div>

    <div class="header-center">
      <div class="doc-title">Смета №${estimate.id}</div>
      <div class="doc-subtitle">${e(estimate.name)}</div>
    </div>

    <div class="header-qr">
      <img src="${qrCodeDataUrl}" alt="QR-код сметы">
      <div class="qr-label">Открыть онлайн</div>
    </div>
  </div>

  <!-- ── Мета ──────────────────────────────────────────────────────────────── -->
  <div class="meta">
    <div><strong>Клиент:</strong> ${e(clientName)}${clientPhone ? ' / ' + e(clientPhone) : ''}</div>
    <div><strong>Дата сметы:</strong> ${estimateDateStr}</div>
    <div><strong>Дата печати:</strong> ${todayStr}</div>
    <div><strong>Позиций:</strong> ${itemCount}</div>
  </div>

  <!-- ── Таблица товаров ────────────────────────────────────────────────────── -->
  <table>
    <thead>
      <tr>
        <th class="col-num center">№</th>
        <th class="col-thumb center">Фото</th>
        <th class="col-name">Наименование товара</th>
        <th class="col-sku">Артикул</th>
        <th class="col-unit center">Ед.</th>
        <th class="col-qty center">Кол-во</th>
        <th class="col-price right">Цена</th>
        <th class="col-sum right">Сумма</th>
        <th class="col-weight right">Вес, кг</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="7" class="totals-label">Итого: ${itemCount} ${itemCount === 1 ? 'позиция' : itemCount < 5 ? 'позиции' : 'позиций'}</td>
        <td class="totals-sum">${e(formatMoney(totalPrice))}</td>
        <td class="totals-weight">${e(formatWeight(totalWeight))}</td>
      </tr>
    </tfoot>
  </table>

  ${totalSavings > 0 ? `
  <div class="savings-bar">
    Ваша экономия по скидкам: <strong>${e(formatMoney(totalSavings))}</strong>
  </div>` : ''}

  <!-- ── Дисклеймер ────────────────────────────────────────────────────────── -->
  <div class="disclaimer">
    <strong>Важно:</strong> Цены актуальны на ${todayStr}. Данный документ не является публичной офертой.
    Актуальную цену и наличие товара уточняйте на сайте <strong>voskhod.ru</strong> или по телефону.
    Компания «Восход» оставляет за собой право изменять цены без предварительного уведомления.
  </div>

  ${autoPrint ? '<script>window.addEventListener("load", () => { window.print(); });<\/script>' : ''}
</body>
</html>`;
}
