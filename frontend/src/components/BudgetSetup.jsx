import { useState } from "react";
import { updateBudget } from "../api/client";

function fmt(n) {
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const TYPE_LABELS = { needs: "Needs", wants: "Wants", savings: "Savings" };
const TYPE_COLORS = {
  needs:   { header: "bg-blue-50 border-blue-200",   badge: "text-blue-700",   bar: "bg-blue-400" },
  wants:   { header: "bg-purple-50 border-purple-200", badge: "text-purple-700", bar: "bg-purple-400" },
  savings: { header: "bg-emerald-50 border-emerald-200", badge: "text-emerald-700", bar: "bg-emerald-400" },
};

function BudgetRow({ category, monthly_limit, type, income, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(monthly_limit));
  const [saving, setSaving] = useState(false);

  async function commit() {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) { setValue(String(monthly_limit)); setEditing(false); return; }
    if (num === monthly_limit) { setEditing(false); return; }
    setSaving(true);
    try {
      await updateBudget(category, num, type);
      onSaved();
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { setValue(String(monthly_limit)); setEditing(false); }
  }

  const pct = income > 0 ? ((monthly_limit / income) * 100).toFixed(0) : 0;

  return (
    <div className="flex items-center justify-between py-2 px-1 group">
      <div className="flex-1 min-w-0">
        <span className="text-sm text-gray-700">{category}</span>
        {income > 0 && <span className="ml-2 text-xs text-gray-400">{pct}%</span>}
      </div>
      {editing ? (
        <div className="flex items-center gap-1">
          <span className="text-sm text-gray-500">$</span>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            className="w-24 border border-blue-400 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 text-right"
            autoFocus
            disabled={saving}
          />
        </div>
      ) : (
        <button
          onClick={() => { setValue(String(monthly_limit)); setEditing(true); }}
          className="text-sm font-medium text-gray-800 hover:text-blue-600 hover:bg-blue-50 rounded px-2 py-0.5 transition-colors"
          title="Click to edit"
        >
          {fmt(monthly_limit)}
        </button>
      )}
    </div>
  );
}

function TypeSection({ type, budgets, income, onSaved }) {
  const colors = TYPE_COLORS[type];
  const total = budgets.reduce((s, b) => s + b.monthly_limit, 0);
  const pct = income > 0 ? ((total / income) * 100).toFixed(0) : null;
  const targets = { needs: 50, wants: 30, savings: 20 };

  return (
    <div className={`border rounded-xl overflow-hidden`}>
      <div className={`${colors.header} border-b px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${colors.badge}`}>{TYPE_LABELS[type]}</span>
          {pct !== null && (
            <span className="text-xs text-gray-500">
              ({pct}% of income · target {targets[type]}%)
            </span>
          )}
        </div>
        <span className="text-sm font-semibold text-gray-700">{fmt(total)}</span>
      </div>
      <div className="bg-white px-4 divide-y">
        {budgets.map((b) => (
          <BudgetRow key={b.category} {...b} income={income} onSaved={onSaved} />
        ))}
        {budgets.length === 0 && (
          <p className="text-xs text-gray-400 py-3 text-center">
            Tell the coach what categories to add here
          </p>
        )}
      </div>
    </div>
  );
}

export default function BudgetSetup({ appState, username, onStateChange }) {
  if (!appState) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading…</div>
    );
  }

  const { income, budgets = [] } = appState;
  const name = username ? `, ${username}` : "";

  const grouped = { needs: [], wants: [], savings: [] };
  for (const b of budgets) {
    const t = grouped[b.type] ? b.type : "needs";
    grouped[t].push(b);
  }

  const totalAllocated = budgets.reduce((s, b) => s + b.monthly_limit, 0);
  const unallocated = income ? income - totalAllocated : null;
  const allocPct = income > 0 ? Math.min((totalAllocated / income) * 100, 100) : 0;

  if (!income && budgets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8 space-y-4">
        <div className="text-5xl">💬</div>
        <h2 className="text-lg font-semibold text-gray-700">Let's build your budget{name}</h2>
        <p className="text-sm text-gray-500 max-w-sm leading-relaxed">
          Tell your coach your monthly take-home income in the chat on the left — it'll walk you
          through setting up your 50/30/20 budget automatically.
        </p>
        <p className="text-xs text-gray-400">Try: "I take home $4,500 a month after taxes"</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full px-6 py-6 space-y-5 max-w-2xl mx-auto">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800">
          {budgets.length === 0 ? `Let's build your budget${name}` : "Your Budget"}
        </h2>
        {income && (
          <p className="text-sm text-gray-500 mt-0.5">Monthly income: <strong>{fmt(income)}</strong></p>
        )}
      </div>

      {/* Allocation progress bar */}
      {income > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Allocated: {fmt(totalAllocated)}</span>
            <span className={unallocated < 0 ? "text-red-500 font-medium" : "text-gray-500"}>
              {unallocated >= 0 ? `${fmt(unallocated)} unallocated` : `${fmt(Math.abs(unallocated))} over income`}
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${allocPct >= 100 ? "bg-red-400" : "bg-blue-400"}`}
              style={{ width: `${allocPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Budget groups */}
      {(["needs", "wants", "savings"]).map((type) => (
        <TypeSection
          key={type}
          type={type}
          budgets={grouped[type]}
          income={income || 0}
          onSaved={onStateChange}
        />
      ))}

      <p className="text-xs text-gray-400 text-center pb-2">
        Click any amount to edit it, or ask your coach to make changes.
      </p>
    </div>
  );
}
