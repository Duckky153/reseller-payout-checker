/* Renders the payout checker. All calculation lives in payout.mjs. */
(function () {
  'use strict';

  const P = window.ResellerPayout;
  const DATA = window.RESELLER_DATA;
  const $ = (id) => document.getElementById(id);
  const money = P.formatCents;

  const escapeHtml = (value) =>
    String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  const contract = P.computePayouts(DATA, { basis: 'contract' });
  const expanded = new Set();

  function statusPill(status) {
    return status === 'Ready'
      ? '<span class="pill pill-ok">Ready</span>'
      : `<span class="pill pill-warn">${escapeHtml(status)}</span>`;
  }

  function lineStatusPill(line) {
    if (line.status === 'counted') return '<span class="pill pill-ok">Counted</span>';
    if (line.status === 'held') return '<span class="pill pill-warn">Held</span>';
    return '<span class="pill pill-neutral">Left out</span>';
  }

  function basisText(row, result) {
    if (!row.terms) return 'No terms on file';
    const own = row.terms.basis;
    const used = row.basis;
    const parts = [`${P.formatRate(row.terms.rateBps)} of ${used}`];
    if (result.mode !== 'contract' && used !== own) parts.push(`(contract: ${own})`);
    parts.push(row.terms.addOnsIncluded ? 'add-ons in' : 'subscription only');
    if (row.terms.termMonths) parts.push(`${row.terms.termMonths}-month term`);
    if (row.minimumCents) parts.push(`${money(row.minimumCents)} minimum`);
    return parts.join(' · ');
  }

  // ------------------------------------------------------------ payout table

  function renderPayouts(result) {
    const showDelta = result.mode !== 'contract';
    const cols = showDelta ? 9 : 8;
    const head = `
      <thead><tr>
        <th scope="col">Reseller</th>
        <th scope="col" class="num">Eligible revenue</th>
        <th scope="col" class="num">Rate</th>
        <th scope="col" class="num">Earned</th>
        <th scope="col" class="num">Clawbacks</th>
        <th scope="col" class="num">Carried forward</th>
        <th scope="col" class="num">Owed now</th>
        ${showDelta ? '<th scope="col" class="num">vs. contract</th>' : ''}
        <th scope="col">Status</th>
      </tr></thead>`;

    const body = result.rows
      .map((row) => {
        const base = contract.rows.find((r) => r.id === row.id);
        const delta = row.owedNowCents - base.owedNowCents;
        const carried = [];
        if (row.carriedInCents) carried.push(`+${money(row.carriedInCents)} from Aug`);
        if (row.carriedOutCents) carried.push(`${money(row.carriedOutCents)} to next month`);
        const open = expanded.has(row.id);
        const detailId = `lines-${row.id}`;
        return `
          <tr class="reseller">
            <th scope="row">
              <button type="button" class="expander" aria-expanded="${open}" aria-controls="${detailId}" data-reseller="${row.id}">${escapeHtml(row.name)}</button>
              <span class="terms-line">${escapeHtml(basisText(row, result))}</span>
            </th>
            <td class="num">${row.terms ? money(row.eligibleCents) : '<span class="muted">unknown</span>'}</td>
            <td class="num">${row.terms ? P.formatRate(row.terms.rateBps) : '<span class="muted">none</span>'}</td>
            <td class="num">${money(row.earnedCents)}</td>
            <td class="num">${row.proposedClawbackCents ? `${money(-row.proposedClawbackCents)}<br><small>proposed, held</small>` : '<span class="muted">-</span>'}</td>
            <td class="num">${carried.length ? carried.join('<br>') : '<span class="muted">-</span>'}</td>
            <td class="num"><strong>${money(row.owedNowCents)}</strong></td>
            ${showDelta ? `<td class="num ${delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'muted'}">${delta === 0 ? 'no change' : `${delta > 0 ? '+' : ''}${money(delta)}`}</td>` : ''}
            <td>${statusPill(row.status)}</td>
          </tr>
          <tr class="detail" id="${detailId}" ${open ? '' : 'hidden'}>
            <td colspan="${cols}">${renderLines(row)}</td>
          </tr>`;
      })
      .join('');

    const t = result.totals;
    const totalDelta = t.readyToPayCents - contract.totals.readyToPayCents;
    const foot = `
      <tfoot><tr>
        <th scope="row">Total</th>
        <td class="num">${money(t.eligibleCents)}</td>
        <td></td>
        <td class="num">${money(t.earnedCents)}</td>
        <td class="num">${t.proposedClawbackCents ? money(-t.proposedClawbackCents) : '-'}</td>
        <td class="num">${t.carriedOutCents ? `${money(t.carriedOutCents)} out` : '-'}</td>
        <td class="num">${money(t.readyToPayCents)}</td>
        ${showDelta ? `<td class="num">${totalDelta === 0 ? 'no change' : `${totalDelta > 0 ? '+' : ''}${money(totalDelta)}`}</td>` : ''}
        <td></td>
      </tr></tfoot>`;

    $('payout-table').innerHTML = `<caption class="visually-hidden">Payout per reseller, ${escapeHtml(result.period.label)}</caption>${head}<tbody>${body}</tbody>${foot}`;
  }

  function renderLines(row) {
    if (!row.lines.length) return '<p class="muted">No September invoices.</p>';
    const rows = row.lines
      .map((l) => {
        const counted = l.status === 'counted';
        const cls = l.status === 'held' ? 'row-held' : l.status === 'excluded' ? 'row-excluded' : '';
        const note = l.movedToId === row.id && l.resellerId !== row.id ? `moved here from ${l.resellerId ? `Reseller ${l.resellerId}` : 'another reseller'}; held` : l.note;
        return `
          <tr class="${cls}">
            <td>${escapeHtml(l.invoiceId)}</td>
            <td>${escapeHtml(l.customerName)}</td>
            <td>${escapeHtml(P.formatShortDate(l.date))}</td>
            <td class="num">${money(l.totalCents)}</td>
            <td class="num">${money(l.paidCents)}</td>
            <td class="num">${counted ? money(l.eligibleCents) : '-'}</td>
            <td class="num">${counted ? money(l.earnedCents) : '-'}</td>
            <td>${lineStatusPill(l)} <small>${escapeHtml(note || '')}</small></td>
          </tr>`;
      })
      .join('');
    const dropped = row.terms
      ? `<p class="rounding-note">Rounding: each counted invoice is rounded down to the cent; ${row.remainder ? `${P.formatFractionOfCent(row.remainder)} dropped across ${row.countedLines.length} invoices` : 'no fractions to drop this month'}.</p>`
      : '';
    return `
      <div class="table-wrap">
        <table class="sub">
          <thead><tr>
            <th scope="col">Invoice</th><th scope="col">Customer</th><th scope="col">Date</th>
            <th scope="col" class="num">Billed</th><th scope="col" class="num">Paid</th>
            <th scope="col" class="num">Eligible</th><th scope="col" class="num">Earned</th><th scope="col">Status</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>${dropped}`;
  }

  // ------------------------------------------------------------ held, watch, notes

  function renderHeld(result) {
    $('held-list').innerHTML = result.held
      .map((h) => {
        const where = [h.customerName, h.invoiceId, h.paymentId && !h.invoiceId ? h.paymentId : null, ...h.resellerIds.map((id) => `Reseller ${id}`)]
          .filter(Boolean)
          .map(escapeHtml)
          .join(' · ');
        const options = h.options
          ? `<div class="table-wrap"><table class="options">
              <thead><tr><th scope="col">Option</th><th scope="col" class="num">Amounts</th></tr></thead>
              <tbody>${h.options
                .map(
                  (o) => `<tr><td>${escapeHtml(o.label)}</td><td class="num">${o.amounts
                    .map((a) => `Reseller ${escapeHtml(a.resellerId)} ${a.cents == null ? 'no terms' : money(a.cents)}`)
                    .join('<br>')}</td></tr>`,
                )
                .join('')}</tbody></table></div>`
          : '';
        return `
          <article class="card held-card">
            <header>
              <h3><span class="id">${escapeHtml(h.id)}</span>${escapeHtml(h.label)}</h3>
              <span class="amount">${money(h.amountCents)}<small>${escapeHtml(h.amountLabel)}</small></span>
            </header>
            <p class="meta">${where || 'No customer or reseller known'}</p>
            <dl>
              <dt>Why it's held</dt><dd>${escapeHtml(h.reason)}</dd>
              <dt>Decision needed</dt><dd>${escapeHtml(h.decision)}</dd>
            </dl>
            ${options}
          </article>`;
      })
      .join('');
  }

  function renderWatch(result) {
    const rows = result.watch
      .map(
        (w) => `
        <tr>
          <td>${escapeHtml(w.invoiceId)}</td>
          <td>${escapeHtml(w.customerName)}</td>
          <td>Reseller ${escapeHtml(w.resellerId)} <small>(${escapeHtml(w.basis)})</small></td>
          <td class="num">${money(w.totalCents)}</td>
          <td class="num">${money(w.paidCents)}</td>
          <td class="num">${money(w.earnedCents)}</td>
          <td>${escapeHtml(w.label)}</td>
        </tr>`,
      )
      .join('');
    $('watch-table').innerHTML = `
      <thead><tr>
        <th scope="col">Invoice</th><th scope="col">Customer</th><th scope="col">Reseller</th>
        <th scope="col" class="num">Billed</th><th scope="col" class="num">Collected</th><th scope="col" class="num">Earned now</th><th scope="col">Why it's on the list</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">Nothing to watch.</td></tr>'}</tbody>`;
    $('notes-list').innerHTML = result.notes.map((n) => `<li>${escapeHtml(n.text)}</li>`).join('');
  }

  // ------------------------------------------------------------ terms + checks

  function renderTerms() {
    const rows = DATA.resellers
      .map((r) => {
        const t = r.terms;
        if (!t) return `<tr><th scope="row">${escapeHtml(r.name)}</th><td colspan="6" class="muted">No terms on file (held)</td></tr>`;
        return `<tr>
          <th scope="row">${escapeHtml(r.name)}</th>
          <td class="num">${P.formatRate(t.rateBps)} <small>(${t.rateBps} bps)</small></td>
          <td>${escapeHtml(t.basis)}</td>
          <td>${t.addOnsIncluded ? 'yes' : 'no'}</td>
          <td>${t.termMonths == null ? 'lifetime' : `first ${t.termMonths} months`}</td>
          <td>${t.clawback ? 'yes' : 'no'}</td>
          <td class="num">${t.minimumCents ? money(t.minimumCents) : 'none'}</td>
        </tr>`;
      })
      .join('');
    $('terms-table').innerHTML = `
      <caption class="visually-hidden">Reseller terms</caption>
      <thead><tr>
        <th scope="col">Reseller</th><th scope="col" class="num">Rate</th><th scope="col">Basis</th><th scope="col">Add-ons count</th>
        <th scope="col">How long</th><th scope="col">Clawback on refunds</th><th scope="col" class="num">Payout minimum</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="7" class="terms-foot">One-time fees never count for anyone.</td></tr></tfoot>`;
  }

  function renderChecks(result) {
    $('checks-list').innerHTML = result.checks
      .map(
        (c) => `
        <li>
          <span class="pill ${c.pass ? 'pill-ok' : 'pill-bad'}">${c.pass ? 'Pass' : 'Fail'}</span>
          <span class="name">${escapeHtml(c.name)}</span>
          <span class="detail">${escapeHtml(c.detail)}</span>
        </li>`,
      )
      .join('');
  }

  // ------------------------------------------------------------ wiring

  let current = contract;

  function render(mode) {
    current = mode === 'contract' ? contract : P.computePayouts(DATA, { basis: mode });
    $('result').textContent = current.sentence;
    renderPayouts(current);
    renderHeld(current);
    renderWatch(current);
    renderChecks(current);
  }

  document.querySelectorAll('input[name="basis"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) render(input.value);
    });
  });

  $('payout-table').addEventListener('click', (event) => {
    const button = event.target.closest('button.expander');
    if (!button) return;
    const id = button.dataset.reseller;
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    $(`lines-${id}`).hidden = !open;
    if (open) expanded.add(id);
    else expanded.delete(id);
  });

  renderTerms();
  const checked = document.querySelector('input[name="basis"]:checked');
  render(checked ? checked.value : 'contract');
})();
