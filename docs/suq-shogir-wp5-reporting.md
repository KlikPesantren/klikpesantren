# Suq Shogir WP5 reporting contract

## Canonical sources

- Sales and returns: immutable `pos_business_operations` and `pos_business_lines`.
- Payment mix: canonical sale payments, refund money movements, AR reversals, and Wallet links.
- COGS: the snapshotted FIFO cost on sale/return lines; reference purchase price is never used.
- Cash, bank, and QRIS balances: `pos_money_movements` per merchant account, plus immutable destination-attributed Wallet settlement payouts for the selected merchant cash/bank account.
- Inventory quantity/value: signed inventory movements at actual layer cost. Online reservations remain a separate availability deduction.
- Receivables/payables: signed `pos_debt_movements`.
- Opening equity: finalized initialization snapshot. Later capital and drawings remain separately classified.
- Wallet settlement: canonical Wallet sale/refund links and immutable settlement payouts.

## Period formulas

- Net sales = posted sales − posted sale returns.
- Net FIFO COGS = sale COGS − returned COGS.
- Gross profit = net sales − net FIFO COGS.
- Operating result = gross profit + classified other operating income − classified operating expenses.
- Capital, drawings, transfers, opening balances, purchases, and settlement payouts are excluded from revenue and operating expense.

The operating result is not labelled statutory net profit. Tax, depreciation, amortization, and other unsupported non-operating classifications are explicitly outside the current model.

## Settlement destination and legacy limitation

Migration 108 adds an immutable merchant cash/bank destination to every new settlement payout. The same payout record now proves the pesantren source outflow, obligation reduction, receiving account, amount, actor, date, reference, and idempotency identity. Reports and spend-authority checks project that payout once into the selected merchant account without creating another sale, revenue row, or Wallet debit.

Existing payout rows from before migration 108 are never guessed or rewritten. Reports therefore:

- exclude Wallet clearing from physical cash;
- show settlement outstanding/recovery separately;
- include destination-attributed payouts in physical cash/bank;
- never invent a receiving account for a legacy payout; and
- mark the financial position incomplete only while a legacy payout lacks destination attribution.

Product category is read from the current product master because historical sale lines do not snapshot category. Product names, SKU, prices, quantities, discounts, revenue, and FIFO cost remain historical snapshots.
