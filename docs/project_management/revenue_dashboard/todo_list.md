# To-Do List: Revenue Dashboard

## Phase 1: Backend & Data Layer
- [ ] **Data Access Object (DAO) / Service Layer**
    - [ ] Create `RevenueService` in `backend/services/revenue_service.py`.
    - [ ] Implement query to sum `introduction_fee` and `management_fee` from contracts by date range.
    - [ ] Implement query to sum `FinancialAdjustment` where type is 'REVENUE' (need to verify types).
    - [ ] Implement query to sum `security_deposit` (Liability).
- [ ] **API Endpoints**
    - [ ] `GET /api/dashboard/revenue/summary`: Returns Total Revenue, Net Income, Held Assets.
    - [ ] `GET /api/dashboard/revenue/trend`: Returns monthly data for charts (YoY, MoM).
    - [ ] `GET /api/dashboard/revenue/composition`: Returns breakdown by type/source.
- [ ] **Data Validation**
    - [ ] Verify calculation logic against 5 random contracts to ensure accuracy.

## Phase 2: Frontend Implementation (Shadcn + Tailwind)
- [ ] **Layout & Structure**
    - [ ] Create `RevenueDashboardPage.jsx`.
    - [ ] Set up Grid layout for KPI cards.
- [ ] **Components**
    - [ ] `KPICard`: Display number, title, and trend icon (green/red arrow).
    - [ ] `RevenueChart`: Use Recharts or Chart.js for the main trend line/bar chart.
    - [ ] `CompositionPieChart`: Donut chart for income sources.
    - [ ] `LiabilitiesPanel`: Separate section for Deposits/Margins with distinct visual style (e.g., storage/vault icon).
- [ ] **Mockups (Deliverable)**
    - [ ] Generate `mockup_executive.html` (High-level).
    - [ ] Generate `mockup_analysis.html` (Detailed table/breakdown).
    - [ ] Generate `mockup_operations.html` (Cash flow focus).

## Phase 3: Integration & Polish
- [ ] Connect Frontend to Backend APIs.
- [ ] Add loading states (Skeleton loaders).
- [ ] Implement date range picker.
- [ ] Responsiveness check (Mobile view).
