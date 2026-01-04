# Design Checklist: Revenue Dashboard

## 1. Data Integrity
- [ ] **Double Counting Rule**: Ensure `CustomerBill` `total_due` isn't added to `Contract` `management_fee` if they represent the same underlying charge.
    - *Check*: If `CustomerBill` is generated from `Contract`, query ONLY `CustomerBill` for realized revenue, or ONLY `Contract` for theoretical revenue.
    - *Decision*: For "Cash Flow/Realized", use `PaymentRecord`. For "Accrued Revenue", use `CustomerBill` (billed). For "Projected", use `Contract`.
- [ ] **Refund Handling**: How are refunds represented?
    - *Check*: Negative `FinancialAdjustment` or negative `PaymentRecord`?

## 2. Visual Clarity (Linus's Taste)
- [ ] **No Clutter**: Do not show "0.00" for fields that are irrelevant.
- [ ] **Hierarchy**: KPI Cards (Big Numbers) > Charts (Trends) > Tables (Details).
- [ ] **Color Semantics**:
    - Green: Revenue/Income.
    - Red/Orange: Expenses/Overdue.
    - Blue/Purple: Deposits/Liabilities (Neutral/Storage).
    - Gray: Projections/Estimates.

## 3. Performance
- [ ] **Query Optimization**: Are we aggregating on the DB side?
    - *Check*: Use `db.session.query(func.sum(...))` instead of fetching all objects and summing in Python.
- [ ] **Indexing**: Are `payment_date`, `created_at`, `type` indexed? (Checked `models.py`, looks good).

## 4. Scalability
- [ ] **New Fee Types**: If we add "Training Fee", does the dashboard break?
    - *Check*: Use dynamic grouping by `adjustment_type` or `contract.type` where possible.
