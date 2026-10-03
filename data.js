/*
 * Synthetic data for one payout period (September 2026).
 * Every reseller, customer, invoice and payment here is made up.
 * Money is in integer cents. Rates are in basis points (100 bps = 1%).
 *
 * This is a plain script with no imports or exports, so the page works when it
 * is opened straight from disk. It puts one object on globalThis.RESELLER_DATA.
 */
(function (root) {
  'use strict';

  // Invoice line helpers. "kind" decides what can earn a reseller share:
  // subscription always can, add_on only if the reseller's terms include add-ons,
  // one_time (implementation, training) never does.
  const sub = (amountCents, description = 'Platform subscription') => ({ kind: 'subscription', description, amountCents });
  const apAddOn = (amountCents = 24900, description = 'AP automation add-on') => ({ kind: 'add_on', description, amountCents });
  const entityAddOn = (amountCents = 14900, description = 'Extra entity add-on') => ({ kind: 'add_on', description, amountCents });
  const oneTime = (amountCents, description) => ({ kind: 'one_time', description, amountCents });
  const invoice = (id, customerId, date, status, lines, extra) =>
    Object.assign({ id, customerId, date, status, lines, refundCents: 0, refundDate: null }, extra || {});
  const payment = (id, invoiceId, amountCents, date) => ({ id, invoiceId, amountCents, date });

  const data = {
    period: { label: 'September 2026', start: '2026-09-01', end: '2026-09-30' },

    // Terms per reseller. termMonths null means the share lasts for the life of the customer.
    // minimumCents: a payout below this carries forward to the next month.
    resellers: [
      { id: 'A', name: 'Reseller A', terms: { rateBps: 2000, basis: 'collected', addOnsIncluded: true, termMonths: null, clawback: true, minimumCents: 0 } },
      { id: 'B', name: 'Reseller B', terms: { rateBps: 1500, basis: 'billed', addOnsIncluded: false, termMonths: 12, clawback: true, minimumCents: 0 } },
      { id: 'C', name: 'Reseller C', terms: { rateBps: 1000, basis: 'collected', addOnsIncluded: true, termMonths: null, clawback: false, minimumCents: 0 } },
      { id: 'D', name: 'Reseller D', terms: { rateBps: 2500, basis: 'collected', addOnsIncluded: false, termMonths: 12, clawback: true, minimumCents: 10000 } },
      { id: 'E', name: 'Reseller E', terms: { rateBps: 1200, basis: 'billed', addOnsIncluded: true, termMonths: null, clawback: false, minimumCents: 0 } },
      { id: 'F', name: 'Reseller F', terms: null }, // tagged on a customer, but no terms on file
    ],

    // resellerId null means a direct customer (no reseller share).
    customers: [
      { id: 'C01', name: 'Contractor 01', resellerId: 'A', startDate: '2025-03-01' },
      { id: 'C02', name: 'Contractor 02', resellerId: 'A', startDate: '2026-01-15' },
      { id: 'C03', name: 'Contractor 03', resellerId: 'A', startDate: '2026-09-01' },
      { id: 'C04', name: 'Contractor 04', resellerId: 'A', startDate: '2024-11-01' },
      { id: 'C05', name: 'Contractor 05', resellerId: 'A', startDate: '2025-06-01' },
      { id: 'C06', name: 'Contractor 06', resellerId: 'A', startDate: '2025-02-01' },
      { id: 'C07', name: 'Contractor 07', resellerId: 'A', startDate: '2025-05-01' },
      { id: 'C08', name: 'Contractor 08', resellerId: 'B', startDate: '2026-02-01' },
      { id: 'C09', name: 'Contractor 09', resellerId: 'B', startDate: '2025-08-15' },
      { id: 'C10', name: 'Contractor 10', resellerId: 'B', startDate: '2026-04-01' },
      { id: 'C11', name: 'Contractor 11', resellerId: 'B', startDate: '2025-10-01' },
      { id: 'C12', name: 'Contractor 12', resellerId: 'B', startDate: '2026-07-01' },
      { id: 'C13', name: 'Contractor 13', resellerId: 'B', startDate: '2026-09-08' },
      { id: 'C14', name: 'Contractor 14', resellerId: 'C', startDate: '2025-01-10' },
      { id: 'C15', name: 'Contractor 15', resellerId: 'C', startDate: '2025-07-01' },
      { id: 'C16', name: 'Contractor 16', resellerId: 'C', startDate: '2026-03-01' },
      { id: 'C17', name: 'Contractor 17', resellerId: 'C', startDate: '2025-11-01', movedTo: { resellerId: 'E', date: '2026-09-21' } },
      { id: 'C18', name: 'Contractor 18', resellerId: 'C', startDate: '2026-05-01' },
      { id: 'C19', name: 'Contractor 19', resellerId: 'C', startDate: '2024-09-01' },
      { id: 'C20', name: 'Contractor 20', resellerId: 'D', startDate: '2026-06-01' },
      { id: 'C21', name: 'Contractor 21', resellerId: 'D', startDate: '2025-08-20' },
      { id: 'C22', name: 'Contractor 22', resellerId: 'E', startDate: '2025-04-01' },
      { id: 'C23', name: 'Contractor 23', resellerId: 'E', startDate: '2026-08-01' },
      { id: 'C24', name: 'Contractor 24', resellerId: 'E', startDate: '2025-12-01' },
      { id: 'C25', name: 'Contractor 25', resellerId: 'E', startDate: '2026-01-01' },
      { id: 'C26', name: 'Contractor 26', resellerId: 'E', startDate: '2026-06-15' },
      { id: 'C27', name: 'Contractor 27', resellerId: 'E', startDate: '2026-09-15' },
      { id: 'C28', name: 'Contractor 28', resellerId: 'F', startDate: '2026-05-01' },
      { id: 'C29', name: 'Contractor 29', resellerId: null, startDate: '2026-07-01' },
      { id: 'C30', name: 'Contractor 30', resellerId: null, startDate: '2025-09-01' },
    ],

    // September invoices, plus the two August invoices that were refunded in September.
    // status is what the billing export says; the checker works out what was actually paid
    // from the payments list.
    invoices: [
      invoice('INV-2609-001', 'C01', '2026-09-01', 'paid', [sub(149900), apAddOn()]),
      invoice('INV-2609-002', 'C02', '2026-09-01', 'paid', [sub(89900)]),
      invoice('INV-2609-003', 'C03', '2026-09-01', 'paid', [sub(64900), oneTime(150000, 'Implementation (one-time)')]),
      invoice('INV-2609-004', 'C04', '2026-09-01', 'partial', [sub(149900), apAddOn()]),
      invoice('INV-2609-005', 'C05', '2026-09-01', 'paid', [sub(89900)]),
      invoice('INV-2609-006', 'C06', '2026-09-01', 'open', [sub(39900), apAddOn()]),
      invoice('INV-2609-007', 'C07', '2026-09-01', 'paid', [sub(119900)]),
      invoice('INV-2609-008', 'C07', '2026-09-15', 'paid', [entityAddOn(7946, 'Extra entity add-on (Sep 15 to 30)')]),
      invoice('INV-2609-009', 'C08', '2026-09-01', 'paid', [sub(119900), apAddOn()]),
      invoice('INV-2609-010', 'C09', '2026-09-01', 'paid', [sub(89900)]),
      invoice('INV-2609-011', 'C10', '2026-09-01', 'partial', [sub(199900)]),
      invoice('INV-2609-012', 'C11', '2026-09-01', 'open', [sub(64900)]),
      invoice('INV-2609-013', 'C12', '2026-09-01', 'paid', [sub(89900), apAddOn()]),
      invoice('INV-2609-014', 'C13', '2026-09-08', 'paid', [sub(49756, 'Platform subscription (Sep 8 to 30)'), oneTime(150000, 'Implementation (one-time)')]),
      invoice('INV-2609-015', 'C13', '2026-09-08', 'void', [sub(64900)]),
      invoice('INV-2609-016', 'C14', '2026-09-01', 'paid', [sub(119900), apAddOn()]),
      invoice('INV-2609-017', 'C15', '2026-09-01', 'paid', [sub(89900)]),
      invoice('INV-2609-018', 'C16', '2026-09-01', 'paid', [sub(64900), entityAddOn()]),
      invoice('INV-2609-019', 'C17', '2026-09-01', 'paid', [sub(149900), apAddOn()]),
      invoice('INV-2609-020', 'C18', '2026-09-01', 'paid', [sub(39900)]),
      invoice('INV-2609-021', 'C19', '2026-09-01', 'paid', [sub(199900), apAddOn()]),
      invoice('INV-2609-022', 'C19', '2026-09-20', 'open', [entityAddOn(5463, 'Extra entity add-on (Sep 20 to 30)')]),
      invoice('INV-2609-023', 'C20', '2026-09-01', 'partial', [sub(39900), apAddOn()]),
      invoice('INV-2609-024', 'C21', '2026-09-01', 'paid', [sub(39900)]),
      invoice('INV-2609-025', 'C22', '2026-09-01', 'paid', [sub(149900), apAddOn()]),
      invoice('INV-2609-026', 'C23', '2026-09-01', 'paid', [sub(89900)]),
      invoice('INV-2609-027', 'C24', '2026-09-01', 'paid', [sub(64900), entityAddOn()]),
      invoice('INV-2609-028', 'C25', '2026-09-01', 'open', [sub(119900)]),
      invoice('INV-2609-029', 'C26', '2026-09-01', 'paid', [sub(39900)]),
      invoice('INV-2609-030', 'C27', '2026-09-15', 'paid', [sub(47946, 'Platform subscription (Sep 15 to 30)'), oneTime(150000, 'Implementation (one-time)')]),
      invoice('INV-2609-031', 'C28', '2026-09-01', 'paid', [sub(89900)]),
      invoice('INV-2609-032', 'C29', '2026-09-01', 'paid', [sub(64900), apAddOn()]),
      invoice('INV-2609-033', 'C30', '2026-09-01', 'paid', [sub(199900)]),
      invoice('INV-2609-034', 'C01', '2026-09-20', 'paid', [entityAddOn(5463, 'Extra entity add-on (Sep 20 to 30)')]),
      invoice('INV-2609-035', 'C14', '2026-09-10', 'paid', [entityAddOn(10430, 'Extra entity add-on (Sep 10 to 30)')]),
      invoice('INV-2609-036', 'C22', '2026-09-25', 'open', [entityAddOn(2980, 'Extra entity add-on (Sep 25 to 30)')]),
      invoice('INV-2609-037', 'C10', '2026-09-15', 'paid', [oneTime(50000, 'Onboarding training (one-time)')]),
      invoice('INV-2609-038', 'C16', '2026-09-18', 'void', [sub(64900)]),
      invoice('INV-2609-039', 'C24', '2026-09-12', 'paid', [apAddOn(15770, 'AP automation add-on (Sep 12 to 30)')]),
      invoice('INV-2609-040', 'C12', '2026-09-20', 'paid', [entityAddOn(5463, 'Extra entity add-on (Sep 20 to 30)')]),

      // August invoices refunded in September (both were in the August payout).
      invoice('INV-2608-002', 'C02', '2026-08-01', 'refunded', [sub(89900)], { refundCents: 44950, refundDate: '2026-09-10' }),
      invoice('INV-2608-016', 'C14', '2026-08-01', 'refunded', [sub(119900), apAddOn()], { refundCents: 144800, refundDate: '2026-09-14' }),
    ],

    // Payments received in September. A blank invoiceId means the payment came in
    // without a reference.
    payments: [
      payment('PAY-001', 'INV-2609-001', 174800, '2026-09-03'),
      payment('PAY-002', 'INV-2609-002', 89900, '2026-09-02'),
      payment('PAY-003', 'INV-2609-003', 214900, '2026-09-05'),
      payment('PAY-004', 'INV-2609-004', 100000, '2026-09-12'),
      payment('PAY-005', 'INV-2609-005', 89900, '2026-09-03'),
      payment('PAY-006', 'INV-2609-005', 89900, '2026-09-04'),
      payment('PAY-007', 'INV-2609-007', 119900, '2026-09-06'),
      payment('PAY-008', 'INV-2609-008', 7946, '2026-09-18'),
      payment('PAY-009', 'INV-2609-009', 144800, '2026-09-04'),
      payment('PAY-010', 'INV-2609-010', 89900, '2026-09-03'),
      payment('PAY-011', 'INV-2609-011', 100000, '2026-09-15'),
      payment('PAY-012', 'INV-2609-013', 114800, '2026-09-08'),
      payment('PAY-013', 'INV-2609-014', 199756, '2026-09-10'),
      payment('PAY-014', 'INV-2609-016', 144800, '2026-09-04'),
      payment('PAY-015', 'INV-2609-017', 89900, '2026-09-05'),
      payment('PAY-016', 'INV-2609-018', 79800, '2026-09-07'),
      payment('PAY-017', 'INV-2609-019', 174800, '2026-09-05'),
      payment('PAY-018', 'INV-2609-020', 39900, '2026-09-03'),
      payment('PAY-019', 'INV-2609-021', 224800, '2026-09-09'),
      payment('PAY-020', 'INV-2609-023', 30000, '2026-09-20'),
      payment('PAY-021', 'INV-2609-024', 39900, '2026-09-09'),
      payment('PAY-022', 'INV-2609-025', 174800, '2026-09-04'),
      payment('PAY-023', 'INV-2609-026', 89900, '2026-09-06'),
      payment('PAY-024', 'INV-2609-027', 79800, '2026-09-05'),
      payment('PAY-025', 'INV-2609-029', 39900, '2026-09-08'),
      payment('PAY-026', 'INV-2609-030', 197946, '2026-09-17'),
      payment('PAY-027', 'INV-2609-031', 89900, '2026-09-04'),
      payment('PAY-028', 'INV-2609-032', 89800, '2026-09-05'),
      payment('PAY-029', 'INV-2609-033', 199900, '2026-09-02'),
      payment('PAY-030', 'INV-2609-034', 5463, '2026-09-22'),
      payment('PAY-031', 'INV-2609-035', 10430, '2026-09-12'),
      payment('PAY-032', 'INV-2609-037', 50000, '2026-09-16'),
      payment('PAY-033', 'INV-2609-039', 15770, '2026-09-14'),
      payment('PAY-034', 'INV-2609-040', 5463, '2026-09-23'),
      payment('PAY-035', '', 64900, '2026-09-19'),
    ],

    // What each reseller was paid for August, and on which invoices.
    // carriedForwardCents is an August amount below the reseller's minimum that rolls into September.
    priorPayouts: [
      { resellerId: 'A', period: 'August 2026', paidOn: '2026-09-05', paidCents: 111920, carriedForwardCents: 0,
        invoices: [{ invoiceId: 'INV-2608-001', earnedCents: 34980 }, { invoiceId: 'INV-2608-002', earnedCents: 17980 }, { invoiceId: 'INV-2608-004', earnedCents: 34980 }, { invoiceId: 'INV-2608-007', earnedCents: 23980 }] },
      { resellerId: 'B', period: 'August 2026', paidOn: '2026-09-05', paidCents: 61455, carriedForwardCents: 0,
        invoices: [{ invoiceId: 'INV-2608-009', earnedCents: 17985 }, { invoiceId: 'INV-2608-011', earnedCents: 29985 }, { invoiceId: 'INV-2608-013', earnedCents: 13485 }] },
      { resellerId: 'C', period: 'August 2026', paidOn: '2026-09-05', paidCents: 63440, carriedForwardCents: 0,
        invoices: [{ invoiceId: 'INV-2608-016', earnedCents: 14480 }, { invoiceId: 'INV-2608-017', earnedCents: 8990 }, { invoiceId: 'INV-2608-019', earnedCents: 17490 }, { invoiceId: 'INV-2608-021', earnedCents: 22480 }] },
      { resellerId: 'D', period: 'August 2026', paidOn: null, paidCents: 0, carriedForwardCents: 3150,
        invoices: [{ invoiceId: 'INV-2608-023', earnedCents: 3150 }] },
      { resellerId: 'E', period: 'August 2026', paidOn: '2026-09-05', paidCents: 35352, carriedForwardCents: 0,
        invoices: [{ invoiceId: 'INV-2608-025', earnedCents: 20988 }, { invoiceId: 'INV-2608-027', earnedCents: 9576 }, { invoiceId: 'INV-2608-029', earnedCents: 4788 }] },
    ],

    // Payments already made toward September (none yet).
    paidTowardPeriod: {},

    // The amount each reseller invoiced us for September. null means no invoice received.
    resellerClaims: { A: 130561, B: 104871, C: 76443, D: null, E: 68518, F: 8990 },
  };

  root.RESELLER_DATA = data;
})(typeof globalThis !== 'undefined' ? globalThis : this);
