/* Renders one reseller statement. Uses the same data.js and payout.mjs as the
   main page, as contracted, so balances match it to the cent. */
(function () {
  'use strict';

  const P = window.ResellerPayout;
  const DATA = window.RESELLER_DATA;
  const $ = (id) => document.getElementById(id);
  const money = P.formatCents;
  const escapeHtml = (value) =>
    String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  const result = P.computePayouts(DATA, { basis: 'contract' });
  let current = null;

  function render(resellerId) {
    current = P.buildStatement(result, resellerId);
    const s = current;
    const row = result.rows.find((r) => r.id === resellerId);

    const lineRows = s.lines.length
      ? s.lines
          .map(
            (l) => `
          <tr>
            <td>${escapeHtml(l.invoiceId)}<span class="line-note">${escapeHtml(P.formatShortDate(l.date))}</span></td>
            <td>${escapeHtml(l.customerName)}${l.note ? `<span class="line-note">${escapeHtml(l.note)}</span>` : ''}</td>
            <td class="num">${money(l.billedCents)}</td>
            <td class="num">${money(l.collectedCents)}</td>
            <td class="num">${money(l.eligibleCents)}</td>
            <td class="num">${P.formatRate(l.rateBps)}</td>
            <td class="num">${money(l.earnedCents)}</td>
          </tr>`,
          )
          .join('')
      : '<tr><td colspan="7" class="muted">No invoices counted this month.</td></tr>';

    const notIncluded = s.notIncluded.length
      ? `<h3>Not included</h3>
         <ul class="adjustments">${s.notIncluded
           .map((n) => `<li><div>${escapeHtml(n.invoiceId)}, ${escapeHtml(n.customerName)}<span class="reason">${escapeHtml(n.reason)}</span></div><span class="num">${money(n.billedCents)} billed</span></li>`)
           .join('')}</ul>`
      : '';

    const adjustments = s.adjustments.length
      ? s.adjustments
          .map((a) => {
            const amount = a.cents == null ? 'to be decided' : money(a.cents);
            const tag = a.inBalance ? '' : ' <span class="pill pill-warn">not in balance</span>';
            return `<li><div>${escapeHtml(a.label)}${tag}${a.reason ? `<span class="reason">${escapeHtml(a.reason)}</span>` : ''}</div><span class="num">${escapeHtml(amount)}</span></li>`;
          })
          .join('')
      : '<li><div class="muted">No adjustments this month.</div></li>';

    const prior = row.prior;
    const priorText = prior
      ? prior.paidCents
        ? `${prior.period}: ${money(prior.paidCents)} paid on ${P.formatShortDate(prior.paidOn)}.`
        : `${prior.period}: nothing paid (below minimum).`
      : 'No earlier payouts.';

    $('statement').innerHTML = `
      <div class="statement-head">
        <div>
          <h2>${escapeHtml(s.reseller.name)}</h2>
          <p>Statement for ${escapeHtml(s.period)} · ${escapeHtml(priorText)}</p>
          <p>Terms: ${escapeHtml(s.termsText)}</p>
        </div>
        ${s.status === 'Ready' ? '<span class="pill pill-ok">Ready</span>' : '<span class="pill pill-warn">Has held items</span>'}
      </div>

      <h3>Invoices counted</h3>
      <div class="table-wrap">
        <table class="lines">
          <thead><tr>
            <th scope="col">Invoice</th><th scope="col">Customer</th>
            <th scope="col" class="num">Billed</th><th scope="col" class="num">Collected</th>
            <th scope="col" class="num">Eligible</th><th scope="col" class="num">Rate</th><th scope="col" class="num">Earned</th>
          </tr></thead>
          <tbody>${lineRows}</tbody>
          <tfoot><tr><th scope="row" colspan="6">Earned in ${escapeHtml(s.period)}</th><td class="num">${money(s.totals.earnedCents)}</td></tr></tfoot>
        </table>
      </div>
      ${notIncluded}

      <h3>Adjustments</h3>
      <ul class="adjustments">${adjustments}</ul>

      <div class="totals" aria-label="Totals">
        <div><span>Earned</span><span class="num">${money(s.totals.earnedCents)}</span></div>
        <div><span>Adjustments</span><span class="num">${money(s.totals.adjustmentsCents)}</span></div>
        <div><span>Previously paid for ${escapeHtml(s.period)}</span><span class="num">${money(s.totals.previouslyPaidCents)}</span></div>
        <div class="due"><span>Balance due</span><span class="num">${money(s.totals.balanceDueCents)}</span></div>
      </div>

      <div class="how">
        <h3>How this was worked out</h3>
        ${s.how.map((sentence) => `<p>${escapeHtml(sentence)}</p>`).join('')}
      </div>`;

    $('copy-status').textContent = '';
    $('csv-fallback').hidden = true;
    if (location.hash !== `#${resellerId}`) {
      try {
        history.replaceState(null, '', `#${resellerId}`);
      } catch (error) {
        // Some browsers refuse history changes on pages opened from disk; the page works without it.
      }
    }
  }

  // Copy as CSV: the clipboard call happens inside the click handler. If the
  // browser refuses, the CSV is shown selected so it can be copied by hand.
  $('copy-csv').addEventListener('click', () => {
    if (!current) return;
    const text = current.csv;
    const fallback = () => {
      const box = $('csv-fallback');
      box.value = text;
      box.hidden = false;
      box.focus();
      box.select();
      $('copy-status').textContent = "Couldn't copy automatically. The CSV is selected below; press Ctrl+C (Cmd+C on a Mac).";
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            $('copy-status').textContent = `Copied ${current.reseller.name}'s statement as CSV.`;
            $('csv-fallback').hidden = true;
          })
          .catch(fallback);
      } else {
        fallback();
      }
    } catch (error) {
      fallback();
    }
  });

  const picker = $('reseller-picker');
  picker.innerHTML = result.rows
    .map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)} · ${escapeHtml(money(r.owedNowCents))} due</option>`)
    .join('');
  picker.addEventListener('change', () => render(picker.value));

  // A link like statements.html#C opens that reseller's statement.
  const fromHash = location.hash.replace('#', '').toUpperCase();
  const start = result.rows.some((r) => r.id === fromHash) ? fromHash : result.rows[0].id;
  picker.value = start;
  render(start);
  window.addEventListener('hashchange', () => {
    const id = location.hash.replace('#', '').toUpperCase();
    if (result.rows.some((r) => r.id === id) && id !== picker.value) {
      picker.value = id;
      render(id);
    }
  });
})();
