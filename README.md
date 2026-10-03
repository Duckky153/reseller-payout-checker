# Reseller Payout Checker

A small static page that works out what each reseller is owed for one month, from invoice and payment exports plus each reseller's terms. Anything that doesn't reconcile is held for a person to decide. It never moves money.

**All data is synthetic.** Resellers are "Reseller A" to "Reseller F", customers are "Contractor 01" to "Contractor 30", and every amount is made up. The reseller terms are assumptions, not anyone's real contract.

Built with AI assistance (Claude Code / Codex).

## What you see

**Payout checker (`index.html`)**

1. One result sentence, worked out live: *"September 2026, synthetic data: $3,366.95 ready to pay across 4 resellers; 6 items held for review ($561.84 of payouts in question, plus $1,548.00 of customer payments to sort out). Nothing here sends money."*
2. A basis control: **As contracted**, **Everyone on billed** or **Everyone on collected**. The last two are a what-if that shows how much each reseller's payout moves.
3. A payout table per reseller: eligible revenue, rate, earned, clawbacks, carried forward, owed now and status. Each row opens to show every September invoice behind it, including the ones left out and why.
4. **Held for review**: one card per item with the type, customer and invoice, the amount at stake, why it was held (one sentence) and the decision a person makes. Below it, a **Watch list** and notes.
5. **Assumptions**: the terms table and every rule in plain words.
6. **Reconciliation checks**, worked out live and shown as pass or fail.
7. **Questions I'd need answered before using this on real numbers.**

**Reseller statements (`statements.html`)**

A one-page statement per reseller, the kind you'd send a partner so nobody has to ask how their payout was worked out. It shows a reseller picker, a header with the terms in one line, the invoices counted (billed, collected, eligible, rate, earned), the invoices not included and why, adjustments, totals (earned, adjustments, previously paid, balance due) and a three-sentence "How this was worked out" box. **Copy as CSV** copies the statement; if the browser blocks the clipboard, the CSV is shown selected so it can be copied by hand. A link like `statements.html#C` opens Reseller C. It reuses `data.js` and `payout.mjs` unchanged, so every balance matches the main page to the cent (a test checks this for every reseller in every basis mode).

## How it works, one sentence per rule

**Money**
- All money is whole cents and every rate is basis points (100 bps = 1%), so nothing is lost to floating-point rounding.
- Every division rounds down to the cent.

**What earns a share**
- Subscriptions always count.
- Add-ons count only if the reseller's terms include add-ons.
- One-time fees (implementation, training) never count.
- Void invoices never count, and direct customers with no reseller are ignored.
- A 12-month term runs from the customer's start date, so invoices dated on or after the anniversary earn nothing; lifetime terms never stop.

**Billed or collected**
- On billed basis, the reseller earns on an invoice when it goes out, paid or not.
- On collected basis, the reseller earns only on the share that was paid: eligible amount times paid over total, rounded down.
- Example: a $1,000 invoice with $600 paid, at 15%, earns $150 on billed and $90 on collected.

**Working out the payout**
- Earned on each invoice = eligible amount times the rate, rounded down to the cent.
- The fractions of a cent that rounding drops are added up and shown, so the lines add up exactly to the totals.
- Owed now = earned this month, plus anything carried in from last month, less anything already paid toward this month.
- If that is below the reseller's payout minimum, all of it carries to next month.
- Held amounts and proposed clawbacks stay out of "ready to pay" until a person decides.

**The six held cases**
1. **Payment with no matching invoice**: it can't be credited to anyone, so it's held; if its amount equals an open invoice balance, the card says which one.
2. **Duplicate payment**: a payment that arrives after its invoice is already paid in full doesn't count as revenue and is held.
3. **Refund after payout**: if the reseller's terms allow clawbacks, the checker proposes taking back the same share of what was paid on that invoice as the share that was refunded, and holds it until someone confirms. If they don't, the refund is absorbed and shown as a note.
4. **Customer moved between resellers mid-month**: held with three options and their amounts: split by days (each reseller's own terms, for the days the customer was theirs), all to the old reseller, or all to the new one.
5. **No terms on file**: a customer tagged to a reseller with no terms is held, because there's no rate to use and nothing is guessed.
6. **Reseller invoice differs**: each reseller's own invoice is compared with what the record says it earned under its contract; any difference is held, and the card says if the invoice matches a different round rate (Reseller B invoiced at 20% instead of 15%).

**Watch list (not held)**
- Part-paid invoices on collected basis are counted pro rata now, and the rest earns when it's paid.
- On billed basis, anything earned before the customer pays is labeled "paid on revenue not yet collected".

**Reconciliation checks (all must pass)**
- Payments total = matched + unmatched + duplicate.
- Invoice lines add up to each reseller's total.
- Ready + held = gross earned, recounted by a separate path that ignores holds.
- No reseller goes negative unless its terms allow clawbacks.
- Rounding is fully shown: line amounts plus dropped fractions equal the exact share.
- Every invoice in the period has exactly one status: counted, left out or held.
- The headline equals the sum of the owed-now column.

## Assumptions

- One month at a time: only invoices dated in September earn in September.
- Refunds are matched only against invoices that were in an earlier payout. A refund on an invoice not yet paid out is flagged as a note to check by hand.
- Any September invoice for a customer who changed resellers during September is held, and the amount in question is the largest of the three options.
- A 12-month term at a new reseller would start on the move date.
- The basis what-if never changes how reseller invoices are checked; they are always compared with the contract.
- No payments have been made toward September yet, so "previously paid" is $0.00 for everyone.

## How to run

- Open `index.html` in a browser. No server, build step, install or network is needed, and it works the same from disk or from GitHub Pages.
- Run the tests with plain Node (version 18 or later):

```
node tests/run-tests.mjs
```

The tests check the hand-worked numbers for every reseller, all six held types, the watch list, all three basis modes, every reconciliation check, the statements matching the main page to the cent, the CSV, and that no page code makes a network call or uses storage.

## Files

| File | What it holds |
|---|---|
| `index.html`, `app.js` | The payout checker page and its rendering. |
| `statements.html`, `statements.js` | The per-reseller statement page. |
| `payout.mjs` | All the calculation, as pure functions with no page code. |
| `data.js` | The synthetic data: terms, customers, invoices, payments, August payouts and reseller invoices. |
| `styles.css` | Layout, light and dark color schemes. |
| `tests/run-tests.mjs` | Plain Node tests, no dependencies. |

`payout.mjs` has no `import` or `export` lines on purpose: browsers won't load ES modules from a page opened straight from disk, so the page loads it as a plain script and Node loads it as a module. It registers its functions on `globalThis.ResellerPayout`.

## Limits

- Synthetic data and assumed terms only. It doesn't read real exports or connect to any billing system.
- It moves no money, sends nothing and saves nothing.
- It doesn't settle disputes about which reseller owns a customer; it shows the options and holds the item.
- One period at a time, with no history across months beyond the August carry-forward and the August payout list.
- Refunds on invoices that haven't been paid out yet, partial refunds of specific line items, and currencies other than US dollars aren't handled.
- The data is small (40 September invoices, 35 payments), so it hasn't been tested on large exports.
