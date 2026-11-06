// Cálculo de presupuestos de pirotecnia compartido entre el navegador y el servidor.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PyroCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const round = (n) => Math.round(n * 100) / 100;

  function itemColors(catalog, item) {
    return (item.colorIds || []).map((id) => (catalog.colors || []).find((c) => c.id === id)).filter(Boolean);
  }

  // lines: [{ itemId, qty, colorId, durationId, moment }]
  function computeQuote(catalog, lines, options) {
    const opts = options || {};
    const fees = catalog.fees || {};
    const out = [];
    const errors = [];
    (Array.isArray(lines) ? lines : []).forEach((line, index) => {
      const item = (catalog.items || []).find((i) => i.id === line.itemId && i.active !== false);
      if (!item) { errors.push(`Línea ${index + 1}: producto no disponible.`); return; }
      const qty = Math.floor(Number(line.qty));
      const min = item.minQty || 1;
      const max = item.maxQty || 99;
      if (!Number.isFinite(qty) || qty < min || qty > max) { errors.push(`${item.name}: la cantidad debe estar entre ${min} y ${max}.`); return; }
      const colors = itemColors(catalog, item);
      const color = colors.find((c) => c.id === line.colorId) || colors[0];
      if (!color) { errors.push(`${item.name}: color no disponible.`); return; }
      const duration = (item.durations || []).find((d) => d.id === line.durationId) || (item.durations || [])[0] || { id: 'std', label: 'Estándar', multiplier: 1 };
      const unit = round((Number(item.unitPrice) + Number(color.surcharge || 0)) * Number(duration.multiplier || 1));
      out.push({
        itemId: item.id,
        kind: item.kind,
        name: item.name,
        unitLabel: item.unitLabel || 'unidad',
        qty,
        colorId: color.id,
        colorName: color.name,
        colorHex: color.hex,
        durationId: duration.id,
        durationLabel: duration.label,
        moment: String(line.moment || '').slice(0, 60),
        unitPrice: unit,
        total: round(unit * qty)
      });
    });
    const itemsTotal = round(out.reduce((s, l) => s + l.total, 0));
    const setup = out.length ? round(Number(fees.setup || 0)) : 0;
    const km = Math.max(0, Number(opts.distanceKm) || 0);
    const travel = out.length ? round(Math.max(0, km - Number(fees.freeKm || 0)) * Number(fees.perKm || 0)) : 0;
    let discountPct = 0;
    (fees.discounts || []).forEach((d) => { if (itemsTotal >= Number(d.min) && Number(d.pct) > discountPct) discountPct = Number(d.pct); });
    const discount = round(itemsTotal * discountPct / 100);
    const base = round(itemsTotal - discount + setup + travel);
    const vatRate = Number(fees.vatRate ?? 0.21);
    const vat = round(base * vatRate);
    return { lines: out, errors, itemsTotal, discountPct, discount, setup, travel, distanceKm: km, base, vatRate, vat, total: round(base + vat) };
  }

  function euros(n) {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0);
  }

  return { computeQuote, euros, itemColors };
});
