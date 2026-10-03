// Plain Node test runner: node tests/run-tests.mjs
// No dependencies. Expected numbers below were worked out by hand from data.js;
// the arithmetic is written next to each one.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await import(pathToFileURL(path.join(projectDir, 'data.js')).href);
await import(pathToFileURL(path.join(projectDir, 'payout.mjs')).href);

const P = globalThis.ResellerPayout;
const DATA = globalThis.RESELLER_DATA;
const fresh = () => structuredClone(DATA);

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}\n     ${error.message.split('\n').join('\n     ')}`);
  }
}

const contract = P.computePayouts(DATA);
const billed = P.computePayouts(DATA, { basis: 'billed' });
const collected = P.computePayouts(DATA, { basis: 'collected' });
const row = (result, id) => result.rows.find((r) => r.id === id);
const heldOf = (result, type) => result.held.filter((h) => h.type === type);

// ------------------------------------------------------------------ data sanity

test('data: six resellers, 30 customers, 40 September invoices, 35 payments', () => {
  assert.equal(DATA.resellers.length, 6);
  assert.equal(DATA.customers.length, 30);
  assert.equal(DATA.invoices.filter((i) => i.date.startsWith('2026-09')).length, 40);
  assert.equal(DATA.payments.length, 35);
  assert.equal(DATA.resellers.find((r) => r.id === 'F').terms, null);
});

test('data: every amount is a whole number of cents', () => {
  for (const inv of DATA.invoices) for (const l of inv.lines) assert.ok(Number.isSafeInteger(l.amountCents), inv.id);
  for (const p of DATA.payments) assert.ok(Number.isSafeInteger(p.amountCents), p.id);
});

test('data: each invoice status agrees with the payments received', () => {
  const byId = new Map(DATA.invoices.map((i) => [i.id, i]));
  const ledger = P.allocatePayments(DATA.payments, byId);
  for (const inv of DATA.invoices.filter((i) => i.date.startsWith('2026-09'))) {
    const total = inv.lines.reduce((s, l) => s + l.amountCents, 0);
    const paid = ledger.paidByInvoice.get(inv.id) || 0;
    if (inv.status === 'paid') assert.equal(paid, total, `${inv.id} should be paid exactly`);
    if (inv.status === 'partial') assert.ok(paid > 0 && paid < total, `${inv.id} should be part paid`);
    if (inv.status === 'open' || inv.status === 'void') assert.equal(paid, 0, `${inv.id} should have no payment`);
  }
});

test('data: no names beyond the synthetic placeholders', () => {
  assert.ok(DATA.resellers.every((r) => /^Reseller [A-F]$/.test(r.name)));
  assert.ok(DATA.customers.every((c) => /^Contractor \d{2}$/.test(c.name)));
});

// ------------------------------------------------------------------ helpers

test('integer helpers round down exactly', () => {
  assert.equal(P.floorDiv(57535200, 10000), 5753); // 47,946 cents x 1200 bps
  assert.equal(P.mulDivFloor(39900, 30000, 64800), 18472); // 18,472.22
  assert.equal(P.mulDivFloor(17980, 44950, 89900), 8990);
});

test('dates: 12-month term ends on the same day a year later, clamped at month end', () => {
  assert.equal(P.addMonths('2025-08-15', 12), '2026-08-15');
  assert.equal(P.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(P.daysBetween('2026-09-01', '2026-09-21'), 20);
  const terms = { termMonths: 12 };
  assert.equal(P.termCheck({ date: '2026-08-14' }, '2025-08-15', terms).covered, true);
  assert.equal(P.termCheck({ date: '2026-08-15' }, '2025-08-15', terms).covered, false);
});

test('formatting: dollars, negatives, rates', () => {
  assert.equal(P.formatCents(336695), '$3,366.95');
  assert.equal(P.formatCents(-8990), '-$89.90');
  assert.equal(P.formatCents(5), '$0.05');
  assert.equal(P.formatRate(1500), '15%');
  assert.equal(P.formatRate(1250), '12.5%');
});

// ------------------------------------------------------------------ as contracted

test('Reseller A: 20% of collected, add-ons in = $1,305.61', () => {
  // 1748.00 + 899.00 + 649.00 (fee out) + 1000.00 (part paid, add-ons in so all of it) + 899.00
  // + 0 (open) + 1199.00 + 79.46 + 54.63 = 6528.09 eligible; lines floored: 349.60 + 179.80 + 129.80
  // + 200.00 + 179.80 + 239.80 + 15.89 + 10.92 = 1305.61
  const a = row(contract, 'A');
  assert.equal(a.eligibleCents, 652809);
  assert.equal(a.earnedCents, 130561);
  assert.equal(a.owedNowCents, 130561);
  assert.equal(a.remainder, 8000); // 0.2 + 0.6 cents dropped
});

test('Reseller B: 15% of billed, subscription only, 12-month term = $786.53', () => {
  // 179.85 + 299.85 (half unpaid) + 97.35 (unpaid) + 134.85 + 74.63 (497.56 x 15% = 74.634)
  const b = row(contract, 'B');
  assert.equal(b.earnedCents, 78653);
  const c09 = contract.lines.find((l) => l.invoiceId === 'INV-2609-010');
  assert.equal(c09.status, 'excluded');
  assert.match(c09.note, /past 12-month term/);
  const training = contract.lines.find((l) => l.invoiceId === 'INV-2609-037');
  assert.equal(training.earnedCents, 0);
  assert.match(training.note, /one-time fee not counted/);
  const addOnOnly = contract.lines.find((l) => l.invoiceId === 'INV-2609-040');
  assert.equal(addOnOnly.earnedCents, 0);
  assert.match(addOnOnly.note, /add-on not covered/);
});

test('Reseller C: 10% of collected = $589.63 ready, moved customer held', () => {
  // 144.80 + 89.90 + 79.80 + 39.90 + 224.80 + 10.43 + 0 (open add-on)
  const c = row(contract, 'C');
  assert.equal(c.earnedCents, 58963);
  assert.equal(c.status, 'Has held items');
});

test('Reseller D: below the $100 minimum, so everything carries forward', () => {
  // INV-2609-023: 399.00 of 648.00 is subscription; 300.00 paid -> floor(39900 x 30000 / 64800) = 184.72
  // x 25% = 46.18; plus 31.50 carried from August = 77.68 < 100.00
  const d = row(contract, 'D');
  assert.equal(d.earnedCents, 4618);
  assert.equal(d.carriedInCents, 3150);
  assert.equal(d.carriedOutCents, 7768);
  assert.equal(d.owedNowCents, 0);
  const pastTerm = contract.lines.find((l) => l.invoiceId === 'INV-2609-024');
  assert.equal(pastTerm.status, 'excluded'); // started 2025-08-20, term ended 2026-08-20
});

test('Reseller E: 12% of billed, add-ons in = $685.18 with 1.52 cents of rounding shown', () => {
  const e = row(contract, 'E');
  assert.equal(e.earnedCents, 68518);
  assert.equal(e.remainder, 15200); // 0.52 + 0.60 + 0.40 cents
});

test('headline: $3,366.95 ready across 4 resellers, 6 held items', () => {
  // 1305.61 + 786.53 + 589.63 + 0 + 685.18
  assert.equal(contract.totals.readyToPayCents, 336695);
  assert.equal(contract.totals.resellersPaid, 4);
  assert.equal(contract.totals.heldCount, 6);
  assert.equal(contract.totals.heldPayoutCents, 8990 + 20976 + 26218);
  assert.equal(contract.totals.heldPaymentCents, 64900 + 89900);
  assert.equal(
    contract.sentence,
    'September 2026, synthetic data: $3,366.95 ready to pay across 4 resellers; 6 items held for review ($561.84 of payouts in question, plus $1,548.00 of customer payments to sort out). Nothing here sends money.',
  );
});

test('headline equals the sum of the owed-now column', () => {
  for (const result of [contract, billed, collected]) {
    assert.equal(result.totals.readyToPayCents, result.rows.reduce((s, r) => s + r.owedNowCents, 0));
    assert.ok(result.sentence.includes(P.formatCents(result.totals.readyToPayCents)));
  }
});

// ------------------------------------------------------------------ held items

test('all six held types appear, at least once each', () => {
  for (const t of P.HELD_TYPES) assert.ok(heldOf(contract, t.type).length >= 1, `missing ${t.type}`);
});

test('held 1: payment with no invoice, matched by amount to an open invoice', () => {
  const [h] = heldOf(contract, 'unmatched_payment');
  assert.equal(h.paymentId, 'PAY-035');
  assert.equal(h.amountCents, 64900);
  assert.deepEqual(h.matchingInvoiceIds, ['INV-2609-012']);
});

test('held 2: second payment on a paid invoice is a duplicate and not revenue', () => {
  const [h] = heldOf(contract, 'duplicate_payment');
  assert.equal(h.paymentId, 'PAY-006');
  assert.equal(h.invoiceId, 'INV-2609-005');
  const line = contract.lines.find((l) => l.invoiceId === 'INV-2609-005');
  assert.equal(line.collectedCents, 89900); // not 179,800
});

test('held 3: refund after payout proposes a clawback, scaled to the refund', () => {
  // A was paid 179.80 on INV-2608-002; half the invoice was refunded -> 89.90
  const [h] = heldOf(contract, 'refund_after_payout');
  assert.equal(h.resellerIds[0], 'A');
  assert.equal(h.clawbackCents, 8990);
  assert.equal(row(contract, 'A').owedNowCents, 130561, 'clawback is not taken until confirmed');
  assert.equal(row(contract, 'A').netIfConfirmedCents, 130561 - 8990);
});

test('no-clawback reseller absorbs a refund as a note, not a held item', () => {
  const note = contract.notes.find((n) => n.kind === 'refund_absorbed');
  assert.equal(note.resellerId, 'C');
  assert.equal(note.amountCents, 14480);
  assert.ok(!contract.held.some((h) => h.type === 'refund_after_payout' && h.resellerIds.includes('C')));
});

test('held 4: moved customer shows three options with amounts', () => {
  // C on collected at 10%: 1748.00 -> 174.80; E on billed at 12%: 209.76
  // split 20 days / 10 days: floor(17480 x 20/30) = 116.53, floor(20976 x 10/30) = 69.92
  const [h] = heldOf(contract, 'customer_moved');
  assert.equal(h.customerName, 'Contractor 17');
  const byKey = Object.fromEntries(h.options.map((o) => [o.key, o]));
  assert.deepEqual(byKey.split.amounts.map((a) => a.cents), [11653, 6992]);
  assert.equal(byKey.old.totalCents, 17480);
  assert.equal(byKey.new.totalCents, 20976);
  assert.equal(h.payoutAtStakeCents, 20976);
  assert.ok(row(contract, 'E').heldIds.includes(h.id) && row(contract, 'C').heldIds.includes(h.id));
});

test('held 5: reseller with no terms is held, not guessed', () => {
  const [h] = heldOf(contract, 'missing_terms');
  assert.equal(h.resellerIds[0], 'F');
  assert.equal(h.invoiceId, 'INV-2609-031');
  assert.match(h.reason, /invoiced \$89\.90/);
  assert.equal(row(contract, 'F').owedNowCents, 0);
});

test('held 6: reseller invoice that differs, with the rate it matches', () => {
  // B invoiced floor(5243.56 x 20%) = 1048.71 vs 786.53 at 15%
  const items = heldOf(contract, 'claim_mismatch');
  assert.equal(items.length, 1);
  assert.equal(items[0].resellerIds[0], 'B');
  assert.equal(items[0].amountCents, 26218);
  assert.equal(items[0].impliedRateBps, 2000);
});

test('watch list: part-paid on collected, and billed-basis amounts not yet collected', () => {
  const ids = contract.watch.map((w) => w.invoiceId).sort();
  assert.deepEqual(ids, ['INV-2609-004', 'INV-2609-011', 'INV-2609-012', 'INV-2609-023', 'INV-2609-028', 'INV-2609-036']);
  assert.equal(contract.watch.find((w) => w.invoiceId === 'INV-2609-011').label, 'Paid on revenue not yet collected');
  assert.equal(contract.watch.find((w) => w.invoiceId === 'INV-2609-004').label, 'Part paid, counted pro rata');
  assert.ok(!contract.held.some((h) => h.invoiceId === 'INV-2609-004'), 'part-paid is watched, not held');
});

// ------------------------------------------------------------------ basis control

test('basis control: everyone on billed raises A and lifts D over its minimum', () => {
  // A: part-paid 1748.00 counts in full (+149.60) and the open 648.00 counts (+129.60)
  assert.equal(row(billed, 'A').earnedCents, 158481);
  // D: 399.00 x 25% = 99.75 + 31.50 carried = 131.25 >= 100.00
  assert.equal(row(billed, 'D').owedNowCents, 13125);
  assert.equal(billed.totals.resellersPaid, 5);
  assert.notEqual(billed.totals.readyToPayCents, contract.totals.readyToPayCents);
});

test('basis control: everyone on collected drops unpaid revenue for B and E', () => {
  assert.equal(row(collected, 'B').earnedCents, 53933); // 786.53 - 149.85 - 97.35
  assert.equal(row(collected, 'E').earnedCents, 53773); // 685.18 - 143.88 - 3.57
  assert.equal(row(collected, 'A').earnedCents, row(contract, 'A').earnedCents);
});

test('basis control: reseller invoices are always compared with the contract', () => {
  for (const result of [billed, collected]) {
    const mismatches = heldOf(result, 'claim_mismatch');
    assert.deepEqual(mismatches.map((h) => h.resellerIds[0]), ['B']);
  }
});

// ------------------------------------------------------------------ reconciliation checks

test('every reconciliation check passes in all three basis modes', () => {
  for (const result of [contract, billed, collected]) {
    for (const c of result.checks) assert.ok(c.pass, `${result.mode}: ${c.name} - ${c.detail}`);
    assert.equal(result.checks.length, 7);
  }
});

test('payments total = matched + unmatched + duplicate', () => {
  const l = contract.ledger;
  assert.equal(l.totalCents, l.matchedCents + l.unmatchedCents + l.duplicateCents);
  assert.equal(l.unmatchedCents, 64900);
  assert.equal(l.duplicateCents, 89900);
});

test('every September invoice has exactly one status', () => {
  const counts = { counted: 0, excluded: 0, held: 0 };
  for (const l of contract.lines) counts[l.status] += 1;
  assert.deepEqual(counts, { counted: 32, excluded: 6, held: 2 });
});

test('an extra payment on a paid invoice is caught as a duplicate and still reconciles', () => {
  const d = fresh();
  d.payments.push({ id: 'PAY-999', invoiceId: 'INV-2609-002', amountCents: 100, date: '2026-09-30' });
  const result = P.computePayouts(d);
  assert.equal(heldOf(result, 'duplicate_payment').length, 2);
  assert.ok(result.checks.find((c) => c.id === 'payments').pass);
  assert.equal(row(result, 'A').earnedCents, row(contract, 'A').earnedCents, 'payout unchanged');
});

// ------------------------------------------------------------------ rule changes behave

test('fixing the data clears the matching held items', () => {
  const d = fresh();
  d.payments = d.payments.filter((p) => p.id !== 'PAY-006' && p.id !== 'PAY-035');
  d.resellerClaims.B = 78653;
  d.resellers.find((r) => r.id === 'F').terms = { rateBps: 1000, basis: 'billed', addOnsIncluded: true, termMonths: null, clawback: false, minimumCents: 0 };
  const result = P.computePayouts(d);
  const types = new Set(result.held.map((h) => h.type));
  assert.deepEqual([...types].sort(), ['customer_moved', 'refund_after_payout']);
  assert.equal(row(result, 'F').earnedCents, 8990); // 899.00 x 10%
  assert.ok(result.checks.every((c) => c.pass));
});

test('a confirmed-style clawback larger than the month is allowed only with clawback terms', () => {
  const d = fresh();
  d.priorPayouts.find((p) => p.resellerId === 'A').invoices.find((i) => i.invoiceId === 'INV-2608-002').earnedCents = 500000;
  const result = P.computePayouts(d);
  const a = row(result, 'A');
  assert.ok(a.netIfConfirmedCents < 0);
  assert.ok(result.checks.find((c) => c.id === 'negative').pass, 'A has clawback terms, so negative is allowed');
});

test('a direct customer never earns a reseller share', () => {
  const lines = contract.lines.filter((l) => l.customerId === 'C29' || l.customerId === 'C30');
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.status === 'excluded' && /direct customer/.test(l.note)));
});

// ------------------------------------------------------------------ statements (follow-up page)

test('statements: balance due matches the main table to the cent, every reseller, every mode', () => {
  for (const result of [contract, billed, collected]) {
    for (const r of result.rows) {
      const s = P.buildStatement(result, r.id);
      assert.equal(s.totals.balanceDueCents, r.owedNowCents, `${result.mode} ${r.id}`);
      assert.equal(s.lines.reduce((t, l) => t + l.earnedCents, 0), s.totals.earnedCents);
      assert.equal(s.how.length, 3);
    }
  }
});

test('statements: D shows the August carry-in and the carry to next month', () => {
  const s = P.buildStatement(contract, 'D');
  assert.deepEqual(s.adjustments.filter((a) => a.inBalance).map((a) => a.cents), [3150, -7768]);
  assert.equal(s.totals.balanceDueCents, 0);
});

test('statements: pending items are listed but kept out of the balance', () => {
  const a = P.buildStatement(contract, 'A');
  const claw = a.adjustments.find((x) => x.label.startsWith('Proposed clawback'));
  assert.equal(claw.cents, -8990);
  assert.equal(claw.inBalance, false);
  const c = P.buildStatement(contract, 'C');
  assert.ok(c.adjustments.some((x) => x.label.startsWith('Held: Contractor 17') && /Split by days/.test(x.reason)));
  assert.ok(c.adjustments.some((x) => x.label.startsWith('Refund absorbed')));
});

test('statements: CSV has a header, one row per line and the four totals', () => {
  const s = P.buildStatement(contract, 'E');
  const rows = s.csv.split('\n');
  assert.equal(rows[0], 'Reseller,Period,Invoice,Customer,Invoice date,Billed,Collected,Eligible,Rate,Earned');
  assert.equal(rows.length, 1 + s.lines.length + s.adjustments.filter((a) => a.inBalance).length + 4);
  assert.equal(rows.at(-1), ',,,,,,,,Balance due,685.18');
});

// ------------------------------------------------------------------ static safety

test('no network calls, storage or outside links anywhere in the page code', () => {
  const files = readdirSync(projectDir).filter((f) => /\.(m?js|html)$/.test(f));
  assert.ok(files.length >= 6);
  for (const f of files) {
    const text = readFileSync(path.join(projectDir, f), 'utf8');
    for (const pattern of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /localStorage/, /https?:\/\//]) {
      assert.ok(!pattern.test(text), `${f} contains ${pattern}`);
    }
  }
});

// ------------------------------------------------------------------ summary

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
