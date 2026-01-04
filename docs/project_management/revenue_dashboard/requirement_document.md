# 需求文档：营收能力仪表盘 (Revenue Dashboard) - Expanded V2

## 1. 核心目标 (Refined)
不仅仅是"看一眼赚了多少钱"，而是要**驱动业务决策**。
从被动展示（Reporting）升级为主动监控（Monitoring）和预测（Forecasting）。

**Linus 视角**: "数据是死的，模式是活的。好的仪表盘应该让你一眼看出*哪里不对劲*，而不是仅仅告诉你*一切正常*。"

## 2. 问题陈述 & 扩展痛点
*   **不仅仅是营收**：营收是**滞后指标** (Lagging Indicator)。此前的合同签得好，现在营收才高。
*   **缺乏预警**：如果本月签约量暴跌，营收可能要几个月后才反应出来，那时候救火已经晚了。
*   **资金效率**：有收入不代表有现金。应收账款 (AR) 堆积是公司倒闭的常见原因。

## 3. 功能需求扩展 (Best Practices)

### 3.1 领先指标 (Leading Indicators) - *New!*
*   **转换漏斗 (Conversion Funnel)**: 线索 -> 试工 -> 签约。如果漏斗变窄，未来营收必跌。
*   **合同续签率 (Renewal Rate)**: 尤其是育儿嫂/月嫂。高续签率意味着"躺赚"的基础稳固。
*   **AR 账龄分析 (Accounts Receivable Aging)**:
    *   "有多少钱是该收没收回来的？"
    *   分段展示：`1-30天`, `31-60天`, `60+天 (危险)`。

### 3.2 运营健康度 (Operational Health) - *New!*
*   **人效分析 (Revenue per Employee)**:
    *   公司每名“销售/顾问”带来的平均营收。
    *   阿姨的平均上户周期（Utilization Rate）。
*   **退单率 & 纠纷成本**:
    *   退款不仅减少营收，还消耗运营成本。需要显眼展示"因纠纷损失的潜在营收"。

### 3.3 目标管理 (Target vs. Actual) - *New!*
*   **仪表盘 (Gauge Charts)**: 设定月度/季度目标。
    *   "本月目标 50万，目前完成 32万 (64%)，时间进度 70%。" -> **结论：落后进度，需加速。**

## 4. 数据结构支持 (Gap Analysis)

*   **Lead/CRM Data**: 目前 `models.py` 主要是 Contract/Bill。需要关联 Sales/CRM 模块（如果存在）来计算转化率。
    *   *Action*: 如果 Sales 模块未开发，暂用 "Draft Contracts" 作为潜在机会。
*   **Budgeting Model**: 数据库目前没有"预算/目标"表。
    *   *Action*: 需要新建 `RevenueTarget` 模型，存储 `month`, `amount`, `type`。

## 5. 建议的新视图：The Command Center
将之前的 3 个概念融合为一个**分层决策中心**：

1.  **Top Layer (上帝视角)**:
    *   实时营收 (Real-time Revenue) vs 目标 (Target)。
    *   现金流健康度 (Runway/Cash Flow)。
2.  **Middle Layer (业务引擎)**:
    *   漏斗转化趋势 (Are we growing?)。
    *   续签/流失预警 (Churn Alert)。
3.  **Bottom Layer (执行细节)**:
    *   待处理催款 (Outstanding Invoices)。
    *   即将到期的合同 (Expiring Contracts for Renewal)。

## 6. UI/UX 升级 (Premium Feel)
*   **暗黑模式默认**: 金融/数据密集型应用通常使用深色背景以减少长期观看的疲劳，并突出彩色数据点。
*   **微交互**: 鼠标悬停显示具体金额构成。
*   **情境化操作**: 点击"逾期账款"数字，直接弹窗显示"一键催款"按钮。
