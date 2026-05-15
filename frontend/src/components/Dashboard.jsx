import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import { Markdown } from "./Chat";

function fmt(n) {
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Coach prompt templates per alert type
function getCoachPrompt(n) {
  switch (n.type) {
    case "over_budget":
      return `I'm over budget on ${n.category}. What should I do to get back on track this month?`;
    case "approaching_limit":
      return `I'm approaching my ${n.category} budget limit. Help me avoid going over before the month ends.`;
    case "high_rent":
      return `My housing cost is high relative to my income. What are my realistic options?`;
    case "debt_budget_gap":
      return `My debt payment strategy isn't aligned with my budget. How do I fix this?`;
    case "low_savings_rate":
      return `My savings rate is low. Help me figure out where to save more each month.`;
    case "high_debt_burden":
      return `My total debt payments are eating too much of my income. What's the best strategy to pay them down faster?`;
    case "unallocated_income":
      return `I have unallocated income each month. Where should I direct it for the best financial outcome?`;
    default:
      return null;
  }
}

const SEVERITY_STYLES = {
  warning: { bg: "bg-red-50 border-red-200", icon: "⚠️", text: "text-red-700", btn: "bg-red-600 hover:bg-red-700" },
  info:    { bg: "bg-blue-50 border-blue-200", icon: "💡", text: "text-blue-700", btn: "bg-blue-600 hover:bg-blue-700" },
};

function AlertCard({ n, onAskCoach }) {
  const s = SEVERITY_STYLES[n.severity] || SEVERITY_STYLES.info;
  const prompt = onAskCoach ? getCoachPrompt(n) : null;
  return (
    <div className={`border rounded-xl px-4 py-3 flex items-start gap-3 ${s.bg}`}>
      <span className="text-xl mt-0.5 shrink-0">{s.icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-relaxed ${s.text}`}>{n.message}</p>
        {prompt && (
          <button
            onClick={() => onAskCoach(prompt)}
            className={`mt-2 text-xs font-semibold text-white px-3 py-1.5 rounded-full transition-colors ${s.btn}`}
          >
            💬 Ask Coach
          </button>
        )}
      </div>
    </div>
  );
}

// Colors for pie chart
const PIE_COLORS = {
  Needs:   "#3b82f6",
  Wants:   "#8b5cf6",
  Savings: "#10b981",
};

const CHART_COLORS = { Budget: "#94a3b8", Spent: "#3b82f6", Over: "#ef4444" };

export default function Dashboard({ appState, onGoToSpending, onGoToDebts, onAskCoach }) {
  const [coachOpen, setCoachOpen] = useState(true);

  if (!appState) {
    return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading…</div>;
  }

  const {
    summary = [],
    notifications = [],
    debts = [],
    has_debts,
    recent_transactions = [],
    budgets = [],
    income,
  } = appState;

  const totalBudgeted = summary.reduce((s, r) => s + r.monthly_limit, 0);
  const totalSpent    = summary.reduce((s, r) => s + r.actual, 0);
  const remaining     = totalBudgeted - totalSpent;
  const monthLabel    = new Date().toLocaleString("default", { month: "long", year: "numeric" });

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const timeElapsedPct = (dayOfMonth / daysInMonth) * 100;
  const spentPct = totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0;
  const isPacingFast = spentPct - timeElapsedPct > 5;

  // ── Chart data ──────────────────────────────────────────────────────────

  // Budget vs Actual BarChart — top categories by limit, truncated names
  const barData = [...summary]
    .filter(r => r.monthly_limit > 0)
    .sort((a, b) => b.monthly_limit - a.monthly_limit)
    .slice(0, 8)
    .map(r => ({
      name: r.category.length > 12 ? r.category.slice(0, 11) + "…" : r.category,
      Budget: r.monthly_limit,
      Spent: Math.min(r.actual, r.monthly_limit),
      Over: r.actual > r.monthly_limit ? r.actual - r.monthly_limit : 0,
    }));

  // Spending by Type PieChart — aggregate actual by needs/wants/savings
  const budgetTypeMap = {};
  for (const b of budgets) budgetTypeMap[b.category] = b.type;
  const typeSpending = { Needs: 0, Wants: 0, Savings: 0 };
  for (const r of summary) {
    const type = budgetTypeMap[r.category];
    if (type === "needs")   typeSpending.Needs   += r.actual;
    if (type === "wants")   typeSpending.Wants   += r.actual;
    if (type === "savings") typeSpending.Savings += r.actual;
  }
  const pieData = Object.entries(typeSpending)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  // ── Alerts (all types) ──────────────────────────────────────────────────
  const ALERT_TYPES = new Set([
    "over_budget", "approaching_limit", "high_rent",
    "debt_budget_gap", "low_savings_rate", "high_debt_burden", "unallocated_income",
  ]);
  const actionableAlerts = notifications.filter(n => ALERT_TYPES.has(n.type));
  const coachTips = notifications.filter(n => n.type === "rag_advice" || n.type === "debt_strategy");

  // Top Expenses
  const topExpenses = [...summary]
    .filter(r => r.actual > 0)
    .sort((a, b) => b.actual - a.actual)
    .slice(0, 3);

  return (
    <div className="overflow-y-auto h-full px-6 py-5 space-y-6">

      {/* ── Actionable Alerts ── */}
      {actionableAlerts.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Alerts</h2>
          <div className="space-y-2">
            {actionableAlerts.map((n, i) => (
              <AlertCard key={i} n={n} onAskCoach={onAskCoach} />
            ))}
          </div>
        </div>
      )}

      {/* ── Coach Tips (collapsible + scrollable) ── */}
      {coachTips.length > 0 && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl overflow-hidden shadow-sm">
          <button
            onClick={() => setCoachOpen(o => !o)}
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-blue-100/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">📚</span>
              <span className="text-sm font-bold text-gray-800">Coach Says</span>
            </div>
            <span className="text-gray-400 text-sm">{coachOpen ? "▲ Collapse" : "▼ Expand"}</span>
          </button>

          {coachOpen && (
            <div className="px-5 pb-4 space-y-3 max-h-60 overflow-y-auto">
              {coachTips.map((n, i) => {
                const raw = n.message.replace(/^Coach Tip:\s*/i, "").trim();
                const isDebtStrategy = n.type === "debt_strategy";
                return (
                  <div key={i} className={`text-sm text-gray-700 leading-relaxed ${i > 0 ? "border-t border-blue-100 pt-3" : ""}`}>
                    {!isDebtStrategy && (
                      <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-1">Tip</p>
                    )}
                    <Markdown text={raw} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Monthly Overview ── */}
      <div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{monthLabel} Overview</h2>
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-white border rounded-xl p-4 text-center shadow-sm">
            <p className="text-xs text-gray-400 mb-1">Income</p>
            <p className="text-base font-bold text-gray-800">{income ? fmt(income) : "$0.00"}</p>
          </div>
          <div className="bg-white border rounded-xl p-4 text-center shadow-sm">
            <p className="text-xs text-gray-400 mb-1">Budgeted</p>
            <p className="text-base font-bold text-gray-800">{fmt(totalBudgeted)}</p>
          </div>
          <div className="bg-white border rounded-xl p-4 text-center shadow-sm">
            <p className="text-xs text-gray-400 mb-1">Spent</p>
            <p className={`text-base font-bold ${totalSpent > totalBudgeted ? "text-red-500" : "text-gray-800"}`}>
              {fmt(totalSpent)}
            </p>
          </div>
          <div className="bg-white border rounded-xl p-4 text-center shadow-sm">
            <p className="text-xs text-gray-400 mb-1">Remaining</p>
            <p className={`text-base font-bold ${remaining < 0 ? "text-red-500" : "text-emerald-600"}`}>
              {fmt(remaining)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Budget vs Actual Chart ── */}
      {barData.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Budget vs. Actual</h2>
          <div className="bg-white border rounded-xl p-4 shadow-sm">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barSize={12}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v}`} width={60} />
                <Tooltip formatter={(v, name) => [fmt(v), name]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Budget" fill={CHART_COLORS.Budget} radius={[3, 3, 0, 0]} />
                <Bar dataKey="Spent"  fill={CHART_COLORS.Spent}  radius={[3, 3, 0, 0]} />
                <Bar dataKey="Over"   fill={CHART_COLORS.Over}   radius={[3, 3, 0, 0]} name="Over Budget" />
              </BarChart>
            </ResponsiveContainer>
            {barData.some(d => d.Over > 0) && (
              <p className="text-xs text-red-500 text-center mt-1">Red bars = over budget</p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* ── Spending by Type PieChart ── */}
        {pieData.length > 0 ? (
          <div>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Spending by Type</h2>
            <div className="bg-white border rounded-xl p-4 shadow-sm flex flex-col items-center">
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={PIE_COLORS[entry.name] || "#94a3b8"} />
                    ))}
                  </Pie>
                  <Tooltip formatter={v => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-1">
                {pieData.map(d => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: PIE_COLORS[d.name] }} />
                    {d.name}: <strong>{fmt(d.value)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Spending by Type</h2>
            <div className="bg-white border rounded-xl p-4 shadow-sm flex items-center justify-center h-44">
              <p className="text-sm text-gray-400">No spending logged yet.</p>
            </div>
          </div>
        )}

        {/* ── Month Pacing ── */}
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Month Pacing</h2>
          <div className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-500">Time Elapsed</span>
                <span className="font-medium text-gray-700">{Math.round(timeElapsedPct)}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="bg-blue-300 h-2 rounded-full" style={{ width: `${timeElapsedPct}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-500">Budget Spent</span>
                <span className={`font-medium ${isPacingFast ? "text-red-500" : "text-gray-700"}`}>
                  {Math.round(spentPct)}%
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className={`${isPacingFast ? "bg-red-400" : "bg-emerald-400"} h-2 rounded-full transition-all duration-500`}
                  style={{ width: `${Math.min(spentPct, 100)}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-center text-gray-500 mt-2">
              {isPacingFast
                ? "You are spending faster than the month is passing."
                : "You are pacing well within your budget."}
            </p>
            {isPacingFast && onAskCoach && (
              <button
                onClick={() => onAskCoach("I'm spending faster than expected this month. Help me slow down.")}
                className="w-full text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors"
              >
                💬 Ask Coach
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Top Expenses ── */}
      <div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Top Expenses</h2>
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden divide-y">
          {topExpenses.length > 0 ? (
            topExpenses.map(r => (
              <div key={r.category} className="flex justify-between px-4 py-3">
                <span className="text-sm text-gray-700 font-medium">{r.category}</span>
                <span className="text-sm font-bold text-gray-800">{fmt(r.actual)}</span>
              </div>
            ))
          ) : (
            <div className="px-4 py-3 text-sm text-gray-500 text-center">No spending logged yet.</div>
          )}
        </div>
      </div>

      {/* ── Recent Transactions ── */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Recent Transactions</h2>
          <button onClick={onGoToSpending} className="text-xs text-blue-600 hover:underline">View all →</button>
        </div>
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden divide-y">
          {recent_transactions.length > 0 ? (
            recent_transactions.map(t => (
              <div key={t.id} className="flex justify-between px-4 py-3 items-center">
                <div>
                  <p className="text-sm font-medium text-gray-800">{t.note || t.category}</p>
                  <p className="text-xs text-gray-400">{t.date} • {t.category}</p>
                </div>
                <span className="text-sm font-bold text-gray-800">{fmt(t.amount)}</span>
              </div>
            ))
          ) : (
            <div className="px-4 py-3 text-sm text-gray-500 text-center">No transactions yet.</div>
          )}
        </div>
      </div>

      {/* ── Debt Summary ── */}
      {has_debts && debts.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Debts</h2>
            <button onClick={onGoToDebts} className="text-xs text-blue-600 hover:underline">View all →</button>
          </div>
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden divide-y">
            {debts.map((d) => {
              const years = d.months_to_payoff ? Math.floor(d.months_to_payoff / 12) : null;
              const mos   = d.months_to_payoff ? d.months_to_payoff % 12 : null;
              const time  = d.months_to_payoff
                ? (years > 0 ? `${years}y ${mos}m` : `${mos}m`)
                : null;
              return (
                <div
                  key={d.name}
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
                  onClick={onGoToDebts}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">{d.name}</p>
                    <p className="text-xs text-gray-400">{d.rate}% APR</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-red-500">{fmt(d.balance)}</p>
                    {time && <p className="text-xs text-emerald-600">Paid off in {time}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
