/*
 * Reseller payout logic: pure functions, no DOM, no network.
 *
 * Money is always integer cents and rates are basis points (100 bps = 1%).
 * Every division rounds down with integer arithmetic, so results are exact.
 *
 * This file has no imports or exports on purpose: browsers refuse to load ES
 * modules from a page opened straight from disk, so the page loads it as a plain
 * script. Node loads it as a module. Either way it registers one object,
 * globalThis.ResellerPayout.
 */
(function (root) {
  'use strict';

  const BPS_WHOLE = 10000;
  const BASIS_MODES = ['contract', 'billed', 'collected'];

  const HELD_TYPES = [
    { type: 'unmatched_payment', label: 'Payment with no matching invoice' },
    { type: 'duplicate_payment', label: 'Duplicate payment' },
    { type: 'refund_after_payout', label: 'Refund after payout' },
    { type: 'customer_moved', label: 'Customer moved between resellers' },
    { type: 'missing_terms', label: 'No terms on file' },
    { type: 'claim_mismatch', label: 'Reseller invoice differs' },
  ];
  const HELD_LABEL = Object.fromEntries(HELD_TYPES.map((t) => [t.type, t.label]));

  // ---------------------------------------------------------------- integers

  function assertCents(value, what) {
    if (!Number.isSafeInteger(value)) throw new Error(`${what} must be a whole number of cents, got ${value}`);
  }

  // floor(a / b) for a >= 0 and b > 0, without floating point.
  function floorDiv(a, b) {
    return (a - (a % b)) / b;
  }

  // floor(a * b / c) for non-negative integers.
  function mulDivFloor(a, b, c) {
    const product = a * b;
    if (!Number.isSafeInteger(product)) throw new Error('amount too large for exact arithmetic');
    return floorDiv(product, c);
  }

  const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);

  // ---------------------------------------------------------------- dates (YYYY-MM-DD strings)

  function toUtc(date) {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function daysBetween(from, to) {
    return Math.round((toUtc(to) - toUtc(from)) / 86400000);
  }

  function addMonths(date, months) {
    const [y, m, d] = date.split('-').map(Number);
    const index = y * 12 + (m - 1) + months;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
  }

  const inPeriod = (date, period) => Boolean(date) && date >= period.start && date <= period.end;
  const byDateThenId = (a, b) => (a.date === b.date ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.date < b.date ? -1 : 1);

  // ---------------------------------------------------------------- formatting

  function formatCents(cents) {
    assertCents(cents, 'amount');
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    const dollars = String(floorDiv(abs, 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
  }

  // Plain dollars for CSV: no symbol, no thousands separator.
  function plainDollars(cents) {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    return `${sign}${floorDiv(abs, 100)}.${String(abs % 100).padStart(2, '0')}`;
  }

  function formatRate(bps) {
    return `${Number((bps / 100).toFixed(2))}%`;
  }

  // A remainder is stored in 1/10,000ths of a cent (cents x bps mod 10,000).
  function formatFractionOfCent(remainder) {
    return `${(remainder / BPS_WHOLE).toFixed(2)}¢`;
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function formatShortDate(date) {
    const [, m, d] = date.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}`;
  }

  function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many}`;
  }

  function termsSummary(terms) {
    if (!terms) return 'No terms on file';
    const parts = [
      `${formatRate(terms.rateBps)} of ${terms.basis} revenue`,
      terms.addOnsIncluded ? 'add-ons included' : 'subscription only',
      terms.termMonths == null ? 'lifetime' : `first ${terms.termMonths} months`,
      terms.clawback ? 'clawback on refunds' : 'no clawback',
      terms.minimumCents > 0 ? `${formatCents(terms.minimumCents)} minimum` : 'no minimum',
    ];
    return parts.join(' · ');
  }

  // ---------------------------------------------------------------- invoice math

  function invoiceTotal(invoice) {
    return sum(invoice.lines, (line) => {
      assertCents(line.amountCents, `${invoice.id} line`);
      return line.amountCents;
    });
  }

  // Revenue that can earn a share under these terms: subscriptions always,
  // add-ons only when included, one-time fees never.
  function shareableBilled(invoice, terms) {
    return sum(invoice.lines, (line) =>
      line.kind === 'subscription' || (line.kind === 'add_on' && terms.addOnsIncluded) ? line.amountCents : 0,
    );
  }

  function basisFor(terms, mode) {
    return mode === 'contract' ? terms.basis : mode;
  }

  // The share for one invoice under one set of terms.
  // Billed basis: the whole shareable amount counts.
  // Collected basis: the shareable amount is scaled by paid / total, rounded down.
  function shareFor(invoice, terms, basis, paidCents) {
    const totalCents = invoiceTotal(invoice);
    const shareableCents = shareableBilled(invoice, terms);
    const collectedCents = Math.min(paidCents, totalCents);
    const eligibleCents =
      basis === 'billed' ? shareableCents : totalCents === 0 ? 0 : mulDivFloor(shareableCents, collectedCents, totalCents);
    const exact = eligibleCents * terms.rateBps;
    return {
      totalCents,
      collectedCents,
      shareableCents,
      eligibleCents,
      rateBps: terms.rateBps,
      basis,
      earnedCents: floorDiv(exact, BPS_WHOLE),
      remainder: exact % BPS_WHOLE,
    };
  }

  // A 12-month term runs from the customer's start date; invoices dated on or
  // after the end date earn nothing.
  function termCheck(invoice, startDate, terms) {
    if (terms.termMonths == null) return { covered: true, endsOn: null };
    const endsOn = addMonths(startDate, terms.termMonths);
    return { covered: invoice.date < endsOn, endsOn };
  }

  function lineNotes(invoice, terms) {
    const notes = [];
    if (invoice.lines.some((l) => l.kind === 'one_time')) notes.push('one-time fee not counted');
    if (!terms.addOnsIncluded && invoice.lines.some((l) => l.kind === 'add_on')) notes.push('add-on not covered');
    return notes;
  }

  // Which reseller a customer belongs to for this period, ignoring a mid-period move.
  function resellerOnFile(customer, period) {
    if (customer.movedTo && customer.movedTo.date <= period.start) return customer.movedTo.resellerId;
    return customer.resellerId;
  }

  function movedDuringPeriod(customer, period) {
    return Boolean(customer.movedTo) && customer.movedTo.date > period.start && customer.movedTo.date <= period.end;
  }

  // ---------------------------------------------------------------- payments

  // Payments are taken in date order. A payment with no invoice reference (or an
  // unknown or void invoice) is unmatched. A payment that arrives after its
  // invoice is already paid in full is a duplicate and doesn't count as revenue.
  function allocatePayments(payments, invoicesById) {
    const paidByInvoice = new Map();
    const paymentsByInvoice = new Map();
    const matched = [];
    const unmatched = [];
    const duplicates = [];
    for (const p of [...payments].sort(byDateThenId)) {
      assertCents(p.amountCents, p.id);
      const invoice = p.invoiceId ? invoicesById.get(p.invoiceId) : undefined;
      if (!invoice || invoice.status === 'void') {
        const why = !p.invoiceId ? 'no_reference' : !invoice ? 'unknown_invoice' : 'void_invoice';
        unmatched.push({ payment: p, why });
        continue;
      }
      const paidSoFar = paidByInvoice.get(invoice.id) || 0;
      if (paidSoFar >= invoiceTotal(invoice)) {
        duplicates.push({ payment: p, invoice, earlierPaymentIds: (paymentsByInvoice.get(invoice.id) || []).slice() });
        continue;
      }
      paidByInvoice.set(invoice.id, paidSoFar + p.amountCents);
      paymentsByInvoice.set(invoice.id, (paymentsByInvoice.get(invoice.id) || []).concat(p.id));
      matched.push(p);
    }
    return {
      paidByInvoice,
      matched,
      unmatched,
      duplicates,
      totalCents: sum(payments, (p) => p.amountCents),
      matchedCents: sum(matched, (p) => p.amountCents),
      unmatchedCents: sum(unmatched, (u) => u.payment.amountCents),
      duplicateCents: sum(duplicates, (d) => d.payment.amountCents),
    };
  }

  // ---------------------------------------------------------------- independent recount

  // Gross earned "on the record": every period invoice credited to the customer's
  // reseller on file, with no holds at all. Used as an independent cross-check
  // and as the number a reseller's own invoice is compared against.
  function grossOnRecord(data, mode) {
    const invoicesById = new Map(data.invoices.map((i) => [i.id, i]));
    const customers = new Map(data.customers.map((c) => [c.id, c]));
    const resellers = new Map(data.resellers.map((r) => [r.id, r]));
    const { paidByInvoice } = allocatePayments(data.payments, invoicesById);
    const gross = new Map();
    for (const invoice of data.invoices) {
      if (!inPeriod(invoice.date, data.period) || invoice.status === 'void') continue;
      const customer = customers.get(invoice.customerId);
      const rid = resellerOnFile(customer, data.period);
      const reseller = rid ? resellers.get(rid) : null;
      if (!reseller || !reseller.terms) continue;
      if (!termCheck(invoice, customer.startDate, reseller.terms).covered) continue;
      const share = shareFor(invoice, reseller.terms, basisFor(reseller.terms, mode), paidByInvoice.get(invoice.id) || 0);
      const entry = gross.get(rid) || { earnedCents: 0, eligibleCents: 0 };
      entry.earnedCents += share.earnedCents;
      entry.eligibleCents += share.eligibleCents;
      gross.set(rid, entry);
    }
    return gross;
  }

  // If a reseller's invoice equals a round rate on the same revenue, say which.
  function impliedRate(eligibleCents, claimCents) {
    for (let bps = 50; bps <= 5000; bps += 50) {
      if (floorDiv(eligibleCents * bps, BPS_WHOLE) === claimCents) return bps;
    }
    return null;
  }

  // ---------------------------------------------------------------- main calculation

  function computePayouts(data, options) {
    const mode = (options && options.basis) || 'contract';
    if (!BASIS_MODES.includes(mode)) throw new Error(`unknown basis mode: ${mode}`);

    const period = data.period;
    const periodDays = daysBetween(period.start, period.end) + 1;
    const resellers = new Map(data.resellers.map((r) => [r.id, r]));
    const customers = new Map(data.customers.map((c) => [c.id, c]));
    const invoicesById = new Map(data.invoices.map((i) => [i.id, i]));
    const priorById = new Map((data.priorPayouts || []).map((p) => [p.resellerId, p]));
    const ledger = allocatePayments(data.payments, invoicesById);
    const paidOf = (invoice) => ledger.paidByInvoice.get(invoice.id) || 0;
    const nameOf = (rid) => (resellers.get(rid) ? resellers.get(rid).name : `Reseller ${rid}`);

    const lines = [];
    const held = [];
    const watch = [];
    const notes = [];
    const addHeld = (item) => held.push(Object.assign({ label: HELD_LABEL[item.type] }, item));

    // 1. Every invoice dated in the period gets exactly one status:
    //    counted, excluded (with a reason) or held (for a person to decide).
    const periodInvoices = data.invoices.filter((i) => inPeriod(i.date, period)).sort(byDateThenId);
    for (const invoice of periodInvoices) {
      const customer = customers.get(invoice.customerId);
      if (!customer) throw new Error(`${invoice.id}: unknown customer ${invoice.customerId}`);
      const rid = resellerOnFile(customer, period);
      const reseller = rid ? resellers.get(rid) : null;
      const base = {
        invoiceId: invoice.id,
        customerId: customer.id,
        customerName: customer.name,
        date: invoice.date,
        resellerId: rid,
        totalCents: invoiceTotal(invoice),
        paidCents: Math.min(paidOf(invoice), invoiceTotal(invoice)),
      };

      if (invoice.status === 'void') {
        lines.push(Object.assign(base, { status: 'excluded', note: 'void invoice' }));
        continue;
      }
      if (!rid) {
        lines.push(Object.assign(base, { status: 'excluded', note: 'direct customer, no reseller' }));
        continue;
      }

      if (movedDuringPeriod(customer, period)) {
        lines.push(Object.assign(base, { status: 'held', heldType: 'customer_moved', movedToId: customer.movedTo.resellerId, note: `moved to ${nameOf(customer.movedTo.resellerId)} on ${formatShortDate(customer.movedTo.date)}` }));
        addHeld(moveItem(invoice, customer, base));
        continue;
      }

      if (!reseller || !reseller.terms) {
        const shareable = sum(invoice.lines, (l) => (l.kind === 'one_time' ? 0 : l.amountCents));
        lines.push(Object.assign(base, { status: 'held', heldType: 'missing_terms', note: 'no terms on file' }));
        const claim = data.resellerClaims ? data.resellerClaims[rid] : null;
        addHeld({
          type: 'missing_terms',
          resellerIds: [rid],
          customerName: customer.name,
          invoiceId: invoice.id,
          amountCents: shareable,
          amountLabel: 'Revenue with no rate',
          payoutAtStakeCents: 0,
          paymentAtStakeCents: 0,
          reason: `${customer.name} is tagged to ${nameOf(rid)}, but there are no terms on file for ${nameOf(rid)}, so there's no rate to use${claim != null ? `; ${nameOf(rid)} invoiced ${formatCents(claim)} for ${period.label}` : ''}.`,
          decision: `Find the signed terms for ${nameOf(rid)}, or remove the tag if the customer isn't theirs.`,
        });
        continue;
      }

      const terms = reseller.terms;
      const term = termCheck(invoice, customer.startDate, terms);
      if (!term.covered) {
        lines.push(Object.assign(base, { status: 'excluded', note: `past ${terms.termMonths}-month term (ended ${formatShortDate(term.endsOn)})` }));
        continue;
      }

      const share = shareFor(invoice, terms, basisFor(terms, mode), paidOf(invoice));
      const lineNoteList = lineNotes(invoice, terms);
      const unpaid = share.collectedCents < share.totalCents;
      if (unpaid && share.basis === 'collected') {
        lineNoteList.push(share.collectedCents === 0 ? 'not paid yet, earns when collected' : 'part paid, counted pro rata');
      } else if (unpaid && share.basis === 'billed') {
        lineNoteList.push('paid on revenue not yet collected');
      }
      if (share.shareableCents === 0) lineNoteList.push('nothing on this invoice earns a share');
      const line = Object.assign(base, share, { status: 'counted', note: lineNoteList.join('; ') });
      lines.push(line);

      // Watch list: part-paid invoices, and anything a billed-basis reseller is
      // being paid on before the customer has paid.
      if (unpaid && share.shareableCents > 0 && (share.basis === 'billed' || share.collectedCents > 0)) {
        watch.push({
          invoiceId: invoice.id,
          customerName: customer.name,
          resellerId: rid,
          basis: share.basis,
          totalCents: share.totalCents,
          paidCents: share.collectedCents,
          earnedCents: share.earnedCents,
          label: share.basis === 'billed' ? 'Paid on revenue not yet collected' : 'Part paid, counted pro rata',
          detail:
            share.basis === 'billed'
              ? `${formatCents(share.collectedCents)} of ${formatCents(share.totalCents)} collected; ${nameOf(rid)} earns ${formatCents(share.earnedCents)} on the full billed amount.`
              : `${formatCents(share.collectedCents)} of ${formatCents(share.totalCents)} collected; ${nameOf(rid)} earns ${formatCents(share.earnedCents)} now and the rest when it's paid.`,
        });
      }
    }

    // A customer who changed resellers mid-period: show three ways to settle it.
    function moveItem(invoice, customer, base) {
      const fromId = customer.resellerId;
      const toId = customer.movedTo.resellerId;
      const from = resellers.get(fromId);
      const to = resellers.get(toId);
      const daysFrom = daysBetween(period.start, customer.movedTo.date);
      const daysTo = periodDays - daysFrom;
      const fullFor = (reseller, startDate) => {
        if (!reseller || !reseller.terms) return null;
        if (!termCheck(invoice, startDate, reseller.terms).covered) return 0;
        return shareFor(invoice, reseller.terms, basisFor(reseller.terms, mode), paidOf(invoice)).earnedCents;
      };
      const fromFull = fullFor(from, customer.startDate);
      const toFull = fullFor(to, customer.movedTo.date); // the new reseller's term starts at the move
      const splitFrom = fromFull == null ? null : mulDivFloor(fromFull, daysFrom, periodDays);
      const splitTo = toFull == null ? null : mulDivFloor(toFull, daysTo, periodDays);
      const options = [
        { key: 'split', label: `Split by days (${daysFrom} / ${daysTo})`, amounts: [{ resellerId: fromId, cents: splitFrom }, { resellerId: toId, cents: splitTo }] },
        { key: 'old', label: `All to ${nameOf(fromId)}`, amounts: [{ resellerId: fromId, cents: fromFull }] },
        { key: 'new', label: `All to ${nameOf(toId)}`, amounts: [{ resellerId: toId, cents: toFull }] },
      ];
      options.forEach((o) => {
        o.totalCents = sum(o.amounts, (a) => a.cents || 0);
      });
      return {
        type: 'customer_moved',
        resellerIds: [fromId, toId],
        customerName: customer.name,
        invoiceId: invoice.id,
        amountCents: Math.max(...options.map((o) => o.totalCents)),
        amountLabel: 'Most it could pay out',
        payoutAtStakeCents: Math.max(...options.map((o) => o.totalCents)),
        paymentAtStakeCents: 0,
        defaultResellerId: fromId,
        defaultEarnedCents: fromFull || 0,
        options,
        reason: `${customer.name} moved from ${nameOf(fromId)} to ${nameOf(toId)} on ${formatShortDate(customer.movedTo.date)}, and ${invoice.id} (${formatCents(base.totalCents)}) covers the whole month.`,
        decision: `Pick one: split by days, all to ${nameOf(fromId)}, or all to ${nameOf(toId)}.`,
      };
    }

    // 2. Payments that can't be credited.
    for (const u of ledger.unmatched) {
      const p = u.payment;
      const openMatches = periodInvoices.filter(
        (i) => i.status !== 'void' && invoiceTotal(i) - paidOf(i) === p.amountCents && paidOf(i) < invoiceTotal(i),
      );
      const hint = openMatches.length
        ? ` Its amount matches the open balance on ${openMatches.map((c) => `${c.id} (${customers.get(c.customerId).name})`).join(', ')}.`
        : '';
      const why = u.why === 'no_reference' ? 'came in with no invoice reference' : u.why === 'void_invoice' ? `points at void invoice ${p.invoiceId}` : `points at unknown invoice ${p.invoiceId}`;
      addHeld({
        type: 'unmatched_payment',
        resellerIds: [],
        paymentId: p.id,
        matchingInvoiceIds: openMatches.map((c) => c.id),
        amountCents: p.amountCents,
        amountLabel: 'Payment',
        payoutAtStakeCents: 0,
        paymentAtStakeCents: p.amountCents,
        reason: `${p.id} (${formatCents(p.amountCents)}, ${formatShortDate(p.date)}) ${why}.${hint}`,
        decision: 'Match it to the right invoice, or return it to whoever sent it.',
      });
    }
    for (const d of ledger.duplicates) {
      const p = d.payment;
      const customer = customers.get(d.invoice.customerId);
      addHeld({
        type: 'duplicate_payment',
        resellerIds: [resellerOnFile(customer, period)].filter(Boolean),
        paymentId: p.id,
        customerName: customer.name,
        invoiceId: d.invoice.id,
        amountCents: p.amountCents,
        amountLabel: 'Payment',
        payoutAtStakeCents: 0,
        paymentAtStakeCents: p.amountCents,
        reason: `${d.invoice.id} was already paid in full by ${d.earlierPaymentIds.join(', ')}, so this second ${formatCents(p.amountCents)} (${p.id}) isn't counted as revenue.`,
        decision: 'Refund the customer, or keep it as a credit on their next invoice.',
      });
    }

    // 3. Refunds dated in the period on invoices that were already paid out.
    for (const invoice of data.invoices) {
      if (!(invoice.refundCents > 0) || !inPeriod(invoice.refundDate, period)) continue;
      assertCents(invoice.refundCents, `${invoice.id} refund`);
      const customer = customers.get(invoice.customerId);
      const rid = customer.resellerId;
      const reseller = rid ? resellers.get(rid) : null;
      const prior = priorById.get(rid);
      const paidOut = prior ? prior.invoices.find((e) => e.invoiceId === invoice.id) : null;
      if (!reseller || !reseller.terms || !paidOut) {
        notes.push({ kind: 'refund_not_paid_out', text: `${customer.name} got ${formatCents(invoice.refundCents)} back on ${invoice.id}, which wasn't in an earlier payout. Check it by hand.` });
        continue;
      }
      const total = invoiceTotal(invoice);
      const clawbackCents = mulDivFloor(paidOut.earnedCents, invoice.refundCents, total);
      if (reseller.terms.clawback) {
        addHeld({
          type: 'refund_after_payout',
          resellerIds: [rid],
          customerName: customer.name,
          invoiceId: invoice.id,
          amountCents: -clawbackCents,
          amountLabel: 'Proposed clawback',
          payoutAtStakeCents: clawbackCents,
          paymentAtStakeCents: 0,
          clawbackCents,
          reason: `${customer.name} got ${formatCents(invoice.refundCents)} of ${formatCents(total)} back on ${invoice.id} on ${formatShortDate(invoice.refundDate)}, after ${reseller.name} was paid ${formatCents(paidOut.earnedCents)} on it for ${prior.period}.`,
          decision: `Confirm the ${formatCents(clawbackCents)} clawback from ${reseller.name}'s payout, or waive it.`,
        });
      } else {
        notes.push({
          kind: 'refund_absorbed',
          resellerId: rid,
          invoiceId: invoice.id,
          amountCents: clawbackCents,
          text: `${customer.name} got ${formatCents(invoice.refundCents)} back on ${invoice.id} on ${formatShortDate(invoice.refundDate)}. ${reseller.name} was paid ${formatCents(paidOut.earnedCents)} on it for ${prior.period}; its terms have no clawback, so ${formatCents(clawbackCents)} of that stays with ${reseller.name} and the refund is absorbed.`,
        });
      }
    }

    // 4. Each reseller's own invoice, compared with what the record says they
    //    earned under their contract terms (before any held item is decided).
    const contractGross = grossOnRecord(data, 'contract');
    for (const reseller of data.resellers) {
      const claim = data.resellerClaims ? data.resellerClaims[reseller.id] : null;
      if (claim == null || !reseller.terms) continue;
      assertCents(claim, `${reseller.name} claim`);
      const record = contractGross.get(reseller.id) || { earnedCents: 0, eligibleCents: 0 };
      if (claim === record.earnedCents) continue;
      const diff = claim - record.earnedCents;
      const implied = impliedRate(record.eligibleCents, claim);
      const impliedText = implied && implied !== reseller.terms.rateBps ? ` Their invoice matches ${formatRate(implied)} of the same revenue.` : '';
      addHeld({
        type: 'claim_mismatch',
        resellerIds: [reseller.id],
        amountCents: diff,
        amountLabel: diff > 0 ? 'Billed above terms' : 'Billed below terms',
        payoutAtStakeCents: Math.abs(diff),
        paymentAtStakeCents: 0,
        claimCents: claim,
        computedCents: record.earnedCents,
        impliedRateBps: implied,
        reason: `${reseller.name} invoiced ${formatCents(claim)}; its terms give ${formatCents(record.earnedCents)} at ${formatRate(reseller.terms.rateBps)}.${impliedText}`,
        decision: `Pay the ${formatCents(record.earnedCents)} the terms give and ask ${reseller.name} to reissue, or confirm a new rate in writing.`,
      });
    }

    const typeOrder = Object.fromEntries(HELD_TYPES.map((t, i) => [t.type, i]));
    held.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);
    held.forEach((item, i) => {
      item.id = `H${i + 1}`;
    });

    // 5. Roll up per reseller.
    const rows = data.resellers.map((reseller) => {
      const terms = reseller.terms;
      const counted = lines.filter((l) => l.status === 'counted' && l.resellerId === reseller.id);
      const related = lines.filter((l) => l.resellerId === reseller.id || l.movedToId === reseller.id);
      const heldHere = held.filter((h) => h.resellerIds.includes(reseller.id));
      const prior = priorById.get(reseller.id);
      const earnedCents = sum(counted, (l) => l.earnedCents);
      const proposedClawbackCents = sum(heldHere.filter((h) => h.type === 'refund_after_payout'), (h) => h.clawbackCents);
      const carriedInCents = prior ? prior.carriedForwardCents || 0 : 0;
      const previouslyPaidCents = (data.paidTowardPeriod && data.paidTowardPeriod[reseller.id]) || 0;
      const subtotal = earnedCents + carriedInCents - previouslyPaidCents;
      const minimumCents = terms ? terms.minimumCents || 0 : 0;
      let owedNowCents = 0;
      let carriedOutCents = 0;
      if (terms) {
        if (subtotal < minimumCents) carriedOutCents = subtotal;
        else owedNowCents = subtotal;
      }
      return {
        id: reseller.id,
        name: reseller.name,
        terms,
        termsText: termsSummary(terms),
        basis: terms ? basisFor(terms, mode) : null,
        lines: related,
        countedLines: counted,
        eligibleCents: sum(counted, (l) => l.eligibleCents),
        earnedCents,
        remainder: sum(counted, (l) => l.remainder),
        proposedClawbackCents,
        carriedInCents,
        carriedOutCents,
        previouslyPaidCents,
        minimumCents,
        owedNowCents,
        netIfConfirmedCents: subtotal - proposedClawbackCents,
        heldIds: heldHere.map((h) => h.id),
        status: heldHere.length ? 'Has held items' : 'Ready',
        claimCents: data.resellerClaims ? data.resellerClaims[reseller.id] : null,
        prior: prior || null,
      };
    });

    // 6. Totals and the one-sentence result.
    const totals = {
      readyToPayCents: sum(rows, (r) => r.owedNowCents),
      resellersPaid: rows.filter((r) => r.owedNowCents > 0).length,
      earnedCents: sum(rows, (r) => r.earnedCents),
      eligibleCents: sum(rows, (r) => r.eligibleCents),
      proposedClawbackCents: sum(rows, (r) => r.proposedClawbackCents),
      carriedOutCents: sum(rows, (r) => r.carriedOutCents),
      heldCount: held.length,
      heldPayoutCents: sum(held, (h) => h.payoutAtStakeCents),
      heldPaymentCents: sum(held, (h) => h.paymentAtStakeCents),
    };
    const modeText = mode === 'contract' ? '' : mode === 'billed' ? ', everyone on billed revenue' : ', everyone on collected revenue';
    const sentence =
      `${period.label}, synthetic data${modeText}: ${formatCents(totals.readyToPayCents)} ready to pay across ${plural(totals.resellersPaid, 'reseller', 'resellers')}; ` +
      `${plural(totals.heldCount, 'item', 'items')} held for review (${formatCents(totals.heldPayoutCents)} of payouts in question, plus ${formatCents(totals.heldPaymentCents)} of customer payments to sort out). ` +
      'Nothing here sends money.';

    // 7. Reconciliation checks, computed every time.
    const gross = grossOnRecord(data, mode);
    const heldDefaultFor = (rid) => sum(held.filter((h) => h.type === 'customer_moved' && h.defaultResellerId === rid), (h) => h.defaultEarnedCents);
    const countedAll = lines.filter((l) => l.status === 'counted');
    const exactShare = sum(countedAll, (l) => l.eligibleCents * l.rateBps);
    const checks = [
      {
        id: 'payments',
        name: 'Every payment is accounted for',
        pass: ledger.totalCents === ledger.matchedCents + ledger.unmatchedCents + ledger.duplicateCents,
        detail: `Payments ${formatCents(ledger.totalCents)} = matched ${formatCents(ledger.matchedCents)} + unmatched ${formatCents(ledger.unmatchedCents)} + duplicate ${formatCents(ledger.duplicateCents)}.`,
      },
      {
        id: 'lines',
        name: 'Invoice lines add up to each reseller total',
        pass: rows.every((r) => sum(r.countedLines, (l) => l.earnedCents) === r.earnedCents) && sum(countedAll, (l) => l.earnedCents) === totals.earnedCents,
        detail: `${countedAll.length} counted lines sum to ${formatCents(sum(countedAll, (l) => l.earnedCents))}; reseller totals sum to ${formatCents(totals.earnedCents)}.`,
      },
      {
        id: 'ready_held',
        name: 'Ready + held = gross earned on the record',
        pass: rows.every((r) => !r.terms || r.earnedCents + heldDefaultFor(r.id) === ((gross.get(r.id) || {}).earnedCents || 0)),
        detail: `Ready lines ${formatCents(totals.earnedCents)} + held lines ${formatCents(sum(held, (h) => h.defaultEarnedCents || 0))} = gross ${formatCents(sum([...gross.values()], (g) => g.earnedCents))}, recounted separately with no holds.`,
      },
      {
        id: 'negative',
        name: 'No reseller goes negative unless its terms allow clawbacks',
        pass: rows.every((r) => r.owedNowCents >= 0 && (r.netIfConfirmedCents >= 0 || (r.terms && r.terms.clawback))),
        detail: `Lowest balance if every proposed clawback were confirmed: ${formatCents(Math.min(...rows.map((r) => r.netIfConfirmedCents)))}.`,
      },
      {
        id: 'rounding',
        name: 'Rounding is fully shown',
        pass: sum(countedAll, (l) => l.earnedCents) * BPS_WHOLE + sum(countedAll, (l) => l.remainder) === exactShare,
        detail: `Each line is rounded down to the cent; ${formatFractionOfCent(sum(countedAll, (l) => l.remainder))} dropped in total, and lines plus dropped fractions equal the exact share.`,
      },
      {
        id: 'invoices',
        name: 'Every invoice in the period has one status',
        pass:
          lines.length === periodInvoices.length &&
          new Set(lines.map((l) => l.invoiceId)).size === lines.length &&
          lines.every((l) => ['counted', 'excluded', 'held'].includes(l.status)),
        detail: `${periodInvoices.length} invoices: ${lines.filter((l) => l.status === 'counted').length} counted, ${lines.filter((l) => l.status === 'excluded').length} excluded, ${lines.filter((l) => l.status === 'held').length} held.`,
      },
      {
        id: 'headline',
        name: 'Headline matches the table',
        pass: totals.readyToPayCents === sum(rows, (r) => r.owedNowCents) && sentence.includes(formatCents(totals.readyToPayCents)),
        detail: `Owed-now column sums to ${formatCents(sum(rows, (r) => r.owedNowCents))}.`,
      },
    ];

    return { period, mode, lines, rows, held, watch, notes, ledger, totals, sentence, checks };
  }

  // ---------------------------------------------------------------- per-reseller statement

  function buildStatement(result, resellerId) {
    const row = result.rows.find((r) => r.id === resellerId);
    if (!row) throw new Error(`unknown reseller ${resellerId}`);
    const held = result.held.filter((h) => row.heldIds.includes(h.id));
    const notes = result.notes.filter((n) => n.resellerId === resellerId);

    const lines = row.countedLines.map((l) => ({
      invoiceId: l.invoiceId,
      customerName: l.customerName,
      date: l.date,
      billedCents: l.totalCents,
      collectedCents: l.collectedCents,
      eligibleCents: l.eligibleCents,
      rateBps: l.rateBps,
      earnedCents: l.earnedCents,
      note: l.note,
    }));
    const notIncluded = row.lines
      .filter((l) => l.status !== 'counted')
      .map((l) => ({ invoiceId: l.invoiceId, customerName: l.customerName, billedCents: l.totalCents, reason: l.status === 'held' ? `held: ${l.note}` : l.note }));

    // Adjustments that change the balance, then pending ones that don't (yet).
    const adjustments = [];
    if (row.carriedInCents) adjustments.push({ label: `Carried forward from ${row.prior ? row.prior.period : 'last period'}`, cents: row.carriedInCents, inBalance: true });
    if (row.carriedOutCents) adjustments.push({ label: `Below the ${formatCents(row.minimumCents)} minimum, carried to next month`, cents: -row.carriedOutCents, inBalance: true });
    for (const h of held) {
      if (h.type === 'refund_after_payout') {
        adjustments.push({ label: `Proposed clawback, ${h.invoiceId}`, cents: -h.clawbackCents, inBalance: false, reason: h.reason });
      } else if (h.type === 'customer_moved') {
        const mine = h.options.map((o) => {
          const a = o.amounts.find((x) => x.resellerId === resellerId);
          return `${o.label}: ${a && a.cents != null ? formatCents(a.cents) : formatCents(0)}`;
        });
        adjustments.push({ label: `Held: ${h.customerName} (${h.invoiceId})`, cents: null, inBalance: false, reason: `${h.reason} ${row.name}'s amount depends on the choice. ${mine.join('; ')}.` });
      } else if (h.type === 'claim_mismatch') {
        adjustments.push({ label: `Held: difference on ${row.name}'s invoice`, cents: h.amountCents, inBalance: false, reason: h.reason });
      } else if (h.type === 'missing_terms') {
        adjustments.push({ label: `Held: ${h.customerName} (${h.invoiceId})`, cents: null, inBalance: false, reason: h.reason });
      } else if (h.type === 'duplicate_payment') {
        adjustments.push({ label: `Held: duplicate payment ${h.paymentId}`, cents: 0, inBalance: false, reason: `${h.reason} It doesn't change ${row.name}'s payout.` });
      }
    }
    for (const n of notes) adjustments.push({ label: `Refund absorbed, ${n.invoiceId}`, cents: 0, inBalance: false, reason: n.text });

    const adjustmentsCents = sum(adjustments.filter((a) => a.inBalance), (a) => a.cents);
    const totals = {
      earnedCents: row.earnedCents,
      adjustmentsCents,
      previouslyPaidCents: row.previouslyPaidCents,
      balanceDueCents: row.earnedCents + adjustmentsCents - row.previouslyPaidCents,
    };

    let how;
    if (!row.terms) {
      how = [
        `There are no terms on file for ${row.name}, so no rate can be used yet.`,
        `Each invoice tagged to ${row.name} is listed as held until signed terms are found.`,
        'Once terms are on file, the same rules as every other reseller will be used and this statement will fill in.',
      ];
    } else {
      const t = row.terms;
      const basisText =
        row.basis === 'collected'
          ? 'collected revenue, so a part-paid invoice counts only for the share that was paid'
          : 'billed revenue, so an invoice counts in full when it is issued, paid or not';
      how = [
        `${row.name} earns ${formatRate(t.rateBps)} of ${basisText}; ${t.addOnsIncluded ? 'subscriptions and add-ons count' : 'only subscriptions count'}, one-time fees never do, and ${t.termMonths == null ? 'the share lasts for the life of each customer' : `the share stops ${t.termMonths} months after each customer starts`}.`,
        `Each invoice's share is rounded down to the cent on its own (${row.remainder ? `${formatFractionOfCent(row.remainder)} dropped in total this month` : 'no fractions to drop this month'}), so the lines add up exactly to the total.`,
        `The balance is ${result.period.label} earnings${row.carriedInCents ? ' plus the amount carried from last month' : ''}, less anything already paid toward it${row.minimumCents ? `, and a balance under ${formatCents(row.minimumCents)} carries to next month` : ''}; held items and proposed clawbacks stay out until someone confirms them.`,
      ];
    }

    return {
      reseller: { id: row.id, name: row.name },
      period: result.period.label,
      termsText: row.termsText,
      status: row.status,
      lines,
      notIncluded,
      adjustments,
      totals,
      how,
      csv: statementCsv(row, result.period.label, lines, adjustments, totals),
    };
  }

  function csvCell(value) {
    const text = String(value == null ? '' : value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function statementCsv(row, periodLabel, lines, adjustments, totals) {
    const out = [['Reseller', 'Period', 'Invoice', 'Customer', 'Invoice date', 'Billed', 'Collected', 'Eligible', 'Rate', 'Earned']];
    for (const l of lines) {
      out.push([row.name, periodLabel, l.invoiceId, l.customerName, l.date, plainDollars(l.billedCents), plainDollars(l.collectedCents), plainDollars(l.eligibleCents), formatRate(l.rateBps), plainDollars(l.earnedCents)]);
    }
    for (const a of adjustments.filter((x) => x.inBalance)) out.push(['', '', '', '', '', '', '', '', a.label, plainDollars(a.cents)]);
    out.push(['', '', '', '', '', '', '', '', 'Earned', plainDollars(totals.earnedCents)]);
    out.push(['', '', '', '', '', '', '', '', 'Adjustments', plainDollars(totals.adjustmentsCents)]);
    out.push(['', '', '', '', '', '', '', '', 'Previously paid', plainDollars(totals.previouslyPaidCents)]);
    out.push(['', '', '', '', '', '', '', '', 'Balance due', plainDollars(totals.balanceDueCents)]);
    return out.map((r) => r.map(csvCell).join(',')).join('\n');
  }

  root.ResellerPayout = Object.freeze({
    BASIS_MODES,
    HELD_TYPES,
    computePayouts,
    buildStatement,
    grossOnRecord,
    allocatePayments,
    shareFor,
    termCheck,
    addMonths,
    daysBetween,
    floorDiv,
    mulDivFloor,
    formatCents,
    formatRate,
    formatShortDate,
    formatFractionOfCent,
    termsSummary,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
