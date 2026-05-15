import { useState } from "react";
import { updateBudget, deleteBudgetCategory } from "../api/client";
import { NotificationsCard } from "./NotificationsCard";

function fmt(n) {
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const TYPE_CONFIG = {
  needs:   { label: "Needs",   target: 50, headerCls: "bg-blue-50 border-blue-200",    badge: "bg-blue-100 text-blue-700",   bar: "bg-blue-400" },
  wants:   { label: "Wants",   target: 30, headerCls: "bg-purple-50 border-purple-200", badge: "bg-purple-100 text-purple-700", bar: "bg-purple-400" },
  savings: { label: "Savings", target: 20, headerCls: "bg-emerald-50 border-emerald-200", badge: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-400" },
};

function EditableLimit({ category, monthly_limit, actual, type, income, onSaved, highlight }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(monthly_limit));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function commit() {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) { setValue(String(monthly_limit)); setEditing(false); return; }
    if (num === monthly_limit) { setEditing(false); return; }
    setSaving(true);
    try { await updateBudget(category, num, type); onSaved(); }
    finally { setSaving(false); setEditing(false); }
  }

  async function handleDelete() {
    if (!window.confirm(`Remove "${category}" from your budget?`)) return;
    setDeleting(true);
    try { await deleteBudgetCategory(category); onSaved(); }
    finally { setDeleting(false); }
  }

  const pct = monthly_limit > 0 ? Math.min((actual / monthly_limit) * 100, 100) : 0;
  const over = actual > monthly_limit && monthly_limit > 0;
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.needs;

  return (
    <div className={`py-3 space-y-2 group rounded-lg transition-colors ${
      highlight ? "bg-amber-50 -mx-4 px-4" : ""
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-gray-800 truncate">{category}</span>
          {income > 0 && (
            <span className="text-xs text-gray-400 shrink-0">
              {((monthly_limit / income) * 100).toFixed(0)}% of income
            </span>
          )}
          {highlight && <span className="text-xs font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">⚠️ Adjust</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs ${over ? "text-red-500" : actual > 0 ? "text-gray-500" : "text-gray-400"}`}>
            {fmt(actual)} spent
          </span>
          {editing ? (
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-400">$</span>
              <input
                type="number" value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setValue(String(monthly_limit)); setEditing(false); } }}
                className="w-24 border-2 border-blue-400 rounded-lg px-2 py-1 text-sm font-semibold focus:outline-none text-right bg-blue-50"
                autoFocus disabled={saving}
              />
              <button onClick={commit} disabled={saving}
                className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? "…" : "Save"}
              </button>
              <button onClick={() => { setValue(String(monthly_limit)); setEditing(false); }}
                className="text-xs text-gray-400 hover:text-gray-600 px-1">✕</button>
            </div>
          ) : (
            <button
              onClick={() => { setValue(String(monthly_limit)); setEditing(true); }}
              className="flex items-center gap-1 text-sm font-semibold text-gray-800 hover:text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-200 rounded-lg px-2 py-1 transition-all"
              title="Click to edit budget limit"
            >
              {fmt(monthly_limit)}
              <span className="opacity-0 group-hover:opacity-100 text-blue-400 text-xs transition-opacity">✏️</span>
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none opacity-0 group-hover:opacity-100 disabled:opacity-50"
            title="Remove category"
          >
            ×
          </button>
        </div>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full transition-all ${over ? "bg-red-400" : cfg.bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {over && (
        <p className="text-xs text-red-500">{fmt(actual - monthly_limit)} over limit</p>
      )}
    </div>
  );
}

function AddSubcategoryRow({ type, onSaved }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const cfg = TYPE_CONFIG[type];

  async function handleSubmit(e) {
    e.preventDefault();
    const num = parseFloat(limit);
    if (!name.trim() || isNaN(num) || num <= 0) return;
    setSaving(true);
    try {
      await updateBudget(name.trim(), num, type);
      setName("");
      setLimit("");
      setOpen(false);
      onSaved();
    } finally { setSaving(false); }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-2.5 text-xs text-gray-400 hover:text-gray-600 flex items-center justify-center gap-1 hover:bg-gray-50 transition-colors"
      >
        <span className="text-base leading-none">+</span> Add subcategory
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="py-3 space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder={`e.g. ${type === "needs" ? "Groceries" : type === "wants" ? "Dining Out" : "Emergency Fund"}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          className="flex-1 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <div className="flex items-center border rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-400">
          <span className="px-2 text-sm text-gray-400">$</span>
          <input
            type="number" step="1" min="1" placeholder="0"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            required
            className="w-24 pr-2 py-1.5 text-sm focus:outline-none"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className={`px-3 py-1 text-white rounded text-xs font-medium disabled:opacity-50 ${cfg.badge.replace("text-", "bg-").replace("100", "500").replace("700", "white")}`}
          style={{ backgroundColor: type === "needs" ? "#3b82f6" : type === "wants" ? "#8b5cf6" : "#10b981" }}
        >
          {saving ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setName(""); setLimit(""); }}
          className="px-3 py-1 bg-gray-100 text-gray-600 rounded text-xs font-medium hover:bg-gray-200">
          Cancel
        </button>
      </div>
    </form>
  );
}

function TypeSection({ type, budgets, summaryMap, income, onSaved, highlightCategory }) {
  const cfg = TYPE_CONFIG[type];
  const totalLimit = budgets.reduce((s, b) => s + b.monthly_limit, 0);
  const totalActual = budgets.reduce((s, b) => s + (summaryMap[b.category]?.actual || 0), 0);
  const pctOfIncome = income > 0 ? ((totalLimit / income) * 100).toFixed(0) : null;

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className={`${cfg.headerCls} border-b px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
          {pctOfIncome !== null && (
            <span className="text-xs text-gray-500">target {cfg.target}% · yours {pctOfIncome}%</span>
          )}
        </div>
        <div className="text-right">
          <span className="text-sm font-semibold text-gray-800">{fmt(totalLimit)}/mo</span>
          {totalActual > 0 && (
            <span className="text-xs text-gray-500 ml-2">{fmt(totalActual)} spent</span>
          )}
        </div>
      </div>
      <div className="bg-white px-4 divide-y">
        {budgets.map((b) => (
          <EditableLimit
            key={b.category}
            {...b}
            actual={summaryMap[b.category]?.actual || 0}
            income={income || 0}
            onSaved={onSaved}
            highlight={b.category === highlightCategory}
          />
        ))}
        <AddSubcategoryRow type={type} onSaved={onSaved} />
      </div>
    </div>
  );
}

const BUDGET_COACH_PROMPTS = {
  over_budget: (cat) => `I'm over budget on ${cat}. What should I do to get back on track this month?`,
  approaching_limit: (cat) => `I'm approaching my ${cat} budget limit. Help me avoid going over.`,
  high_rent: () => `My housing cost is high relative to my income. What are my realistic options?`,
  debt_budget_gap: () => `My debt payment strategy isn't aligned with my budget. How do I fix this?`,
  low_savings_rate: () => `My savings rate is low. Help me figure out where to save more each month.`,
  high_debt_burden: () => `My total debt payments are eating too much of my income. What's the best strategy to pay them down faster?`,
};

export default function Budget({ appState, onStateChange, onAskCoach }) {
  const [highlightCategory, setHighlightCategory] = useState(null);

  if (!appState) {
    return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading…</div>;
  }

  const { budgets = [], summary = [], income, notifications = [] } = appState;

  const budgetNotifications = notifications.filter(n =>
    n.type === "over_budget" ||
    n.type === "approaching_limit" ||
    n.type === "high_rent" ||
    n.type === "debt_budget_gap"
  );

  const summaryMap = {};
  for (const row of summary) summaryMap[row.category] = row;

  const grouped = { needs: [], wants: [], savings: [] };
  for (const b of budgets) {
    const t = grouped[b.type] !== undefined ? b.type : "needs";
    grouped[t].push(b);
  }

  const totalBudgeted = budgets.reduce((s, b) => s + b.monthly_limit, 0);
  const totalSpent    = summary.reduce((s, r) => s + r.actual, 0);
  const allocPct = income > 0 ? Math.min((totalBudgeted / income) * 100, 100) : 0;

  // Parse which category the debt_budget_gap alert is complaining about
  const debtGapAlert = notifications.find(n => n.type === "debt_budget_gap");
  const debtCategory = debtGapAlert
    ? budgets.find(b => b.category.toLowerCase().includes("debt"))
    : null;

  function scrollAndHighlight(category) {
    setHighlightCategory(category);
    setTimeout(() => setHighlightCategory(null), 3000);
    // Scroll to savings section where Debt Payments usually lives
    document.getElementById("section-savings")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="overflow-y-auto h-full px-6 py-6 space-y-5 max-w-2xl mx-auto">
      {budgetNotifications.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Budget Alerts</h2>
          <div className="space-y-2">
            {budgetNotifications.map((n, i) => {
              const isDebtGap = n.type === "debt_budget_gap";
              return (
                <div key={i} className={`border rounded-xl px-4 py-3 flex items-start gap-3 ${
                  isDebtGap ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"
                }`}>
                  <span className="text-xl mt-0.5 shrink-0">{isDebtGap ? "⚠️" : "🚨"}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-relaxed ${
                      isDebtGap ? "text-amber-800" : "text-red-700"
                    }`}>{n.message}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {isDebtGap && debtCategory && (
                        <button
                          onClick={() => scrollAndHighlight(debtCategory.category)}
                          className="text-xs font-semibold bg-amber-600 text-white px-3 py-1 rounded-full hover:bg-amber-700 transition-colors"
                        >
                          ✏️ Adjust "{debtCategory.category}" now
                        </button>
                      )}
                      {onAskCoach && BUDGET_COACH_PROMPTS[n.type] && (
                        <button
                          onClick={() => onAskCoach(BUDGET_COACH_PROMPTS[n.type](n.category))}
                          className="text-xs font-semibold bg-blue-600 text-white px-3 py-1 rounded-full hover:bg-blue-700 transition-colors"
                        >
                          💬 Ask Coach
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary bar */}
      {income > 0 && (
        <div className="bg-white border rounded-xl p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Monthly income: <strong>{fmt(income)}</strong></span>
            <span className="text-gray-600">Budgeted: <strong>{fmt(totalBudgeted)}</strong></span>
            {totalSpent > 0 && <span className="text-gray-600">Spent this month: <strong>{fmt(totalSpent)}</strong></span>}
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${allocPct >= 100 ? "bg-red-400" : "bg-blue-400"}`}
              style={{ width: `${allocPct}%` }}
            />
          </div>
          <p className="text-xs text-gray-400">
            {income - totalBudgeted >= 0
              ? `${fmt(income - totalBudgeted)} unallocated`
              : `${fmt(Math.abs(income - totalBudgeted))} over income`}
          </p>
        </div>
      )}

      {/* Type sections */}
      {["needs", "wants", "savings"].map((type) => (
        <div key={type} id={`section-${type}`}>
          <TypeSection
            type={type}
            budgets={grouped[type]}
            summaryMap={summaryMap}
            income={income || 0}
            onSaved={onStateChange}
            highlightCategory={highlightCategory}
          />
        </div>
      ))}

      <p className="text-xs text-gray-400 text-center pb-2">
        Click the <strong>amount ✏️</strong> on any category to edit its limit
      </p>
    </div>
  );
}
