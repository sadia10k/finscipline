import { useState, useEffect } from "react";
import { addDebt, updateDebt, deleteDebt, getDebtAdvice, setExtraDebtPayment, updateBudget } from "../api/client";
import { ExpandableMessage } from "./NotificationsCard";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

function fmt(n) {
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtMo(n) {
  if (!n) return "—";
  const y = Math.floor(n / 12), m = n % 12;
  return y > 0 ? `${y}y ${m}m` : `${m}m`;
}

const LINE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];

// ── Proper snowball paydown chart ─────────────────────────────────────────────
function buildPaydownData(debts, extraPayment) {
  if (!debts.length) return [];
  const maxMonths = Math.max(...debts.map(d => d.months_to_payoff || 0), 1);
  const cap = Math.min(maxMonths, 120);
  const step = cap > 60 ? 3 : 1;
  const data = [];

  for (let m = 0; m <= cap; m += step) {
    const point = { month: m };
    let rollingExtra = extraPayment;

    for (let di = 0; di < debts.length; di++) {
      const d = debts[di];
      const monthlyRate = d.rate / 100 / 12;
      const payment = d.minimum_payment + rollingExtra;
      let balance = d.balance;

      for (let i = 0; i < m; i++) {
        if (balance <= 0) break;
        const interest = balance * monthlyRate;
        const principal = payment - interest;
        if (principal <= 0) break;
        balance = Math.max(0, balance - principal);
      }
      point[d.name] = Math.round(balance * 100) / 100;
      // If this debt is paid off, roll its minimum to next debt
      if (balance <= 0) rollingExtra += d.minimum_payment;
    }
    data.push(point);
  }
  return data;
}

// ── Add Debt Form ─────────────────────────────────────────────────────────────
function AddDebtForm({ onAdded }) {
  const [form, setForm] = useState({ name: "", balance: "", rate: "", minimum_payment: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(field, val) { setForm(f => ({ ...f, [field]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await addDebt(form.name, parseFloat(form.balance), parseFloat(form.rate), parseFloat(form.minimum_payment));
      setForm({ name: "", balance: "", rate: "", minimum_payment: "" });
      onAdded();
    } catch (err) {
      setError(err.response?.data?.detail || "Could not add debt.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border rounded-xl p-5 space-y-3 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700">Add a Debt</h3>
      <div className="grid grid-cols-2 gap-3">
        <input
          type="text" placeholder="Name (e.g. Visa)" value={form.name}
          onChange={e => set("name", e.target.value)} required
          className="col-span-2 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <input
          type="number" step="0.01" min="0.01" placeholder="Balance ($)" value={form.balance}
          onChange={e => set("balance", e.target.value)} required
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <input
          type="number" step="0.01" min="0" placeholder="APR (%)" value={form.rate}
          onChange={e => set("rate", e.target.value)} required
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <input
          type="number" step="0.01" min="0.01" placeholder="Min payment ($/mo)" value={form.minimum_payment}
          onChange={e => set("minimum_payment", e.target.value)} required
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 col-span-2"
        />
      </div>
      {error && <p className="text-red-500 text-xs">{error}</p>}
      <button
        type="submit" disabled={saving}
        className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {saving ? "Adding…" : "Add Debt"}
      </button>
    </form>
  );
}

// ── Snowball Debt Card (with inline edit + delete) ────────────────────────────
function DebtCard({ debt, rank, onSaved }) {
  const { id, name, balance, rate, minimum_payment, effective_payment, extra_applied, months_to_payoff, interest_paid, payoff_note } = debt;
  const isTarget = rank === 0 && !payoff_note;

  const [editing, setEditing] = useState(false);
  const [form, setForm]       = useState({ name, balance: String(balance), rate: String(rate), minimum_payment: String(minimum_payment) });
  const [saving, setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError]     = useState("");

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await updateDebt(id, form.name, parseFloat(form.balance), parseFloat(form.rate), parseFloat(form.minimum_payment));
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Remove "${name}" from your debts?`)) return;
    setDeleting(true);
    try {
      await deleteDebt(id);
      onSaved();
    } catch {
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={handleSave} className={`bg-white border-2 border-blue-400 rounded-xl p-4 space-y-3 shadow-md`}>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Edit Debt</p>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text" placeholder="Name" value={form.name}
            onChange={e => setField("name", e.target.value)} required
            className="col-span-2 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input
              type="number" step="0.01" min="0.01" placeholder="Balance" value={form.balance}
              onChange={e => setField("balance", e.target.value)} required
              className="w-full border rounded-lg pl-6 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div className="relative">
            <input
              type="number" step="0.01" min="0" placeholder="APR %" value={form.rate}
              onChange={e => setField("rate", e.target.value)} required
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
          </div>
          <div className="relative col-span-2">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input
              type="number" step="0.01" min="0.01" placeholder="Min payment / mo" value={form.minimum_payment}
              onChange={e => setField("minimum_payment", e.target.value)} required
              className="w-full border rounded-lg pl-6 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={saving}
            className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => { setEditing(false); setError(""); }}
            className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200">
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className={`bg-white border rounded-xl p-4 space-y-2 group ${isTarget ? "border-blue-400 shadow-md shadow-blue-100" : ""}`}>
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2 min-w-0">
          {isTarget && <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full shrink-0">🎯 Focus</span>}
          <span className="font-medium text-gray-800 truncate">{name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-red-500 font-semibold text-sm">{fmt(balance)}</span>
          <button
            onClick={() => setEditing(true)}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-all text-sm px-1"
            title="Edit debt"
          >✏️</button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all text-lg leading-none disabled:opacity-50"
            title="Delete debt"
          >×</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        <span>{rate}% APR</span>
        <span>Min: {fmt(minimum_payment)}/mo</span>
        {extra_applied > 0 && (
          <span className="text-blue-600 font-medium">+{fmt(extra_applied)} extra → {fmt(effective_payment)}/mo total</span>
        )}
      </div>
      {payoff_note ? (
        <p className="text-xs text-red-500 font-medium">{payoff_note}</p>
      ) : (
        <div className="flex gap-4 text-xs">
          <span className="text-emerald-600 font-medium">✅ Paid off in {fmtMo(months_to_payoff)}</span>
          {interest_paid > 0 && <span className="text-gray-400">Total interest: {fmt(interest_paid)}</span>}
        </div>
      )}
    </div>
  );
}

// ── Extra Payment Slider ──────────────────────────────────────────────────────
function ExtraPaymentPanel({ currentExtra, income, budgets, summary, onSaved }) {
  const [value, setValue] = useState(currentExtra || 0);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(currentExtra || 0); }, [currentExtra]);

  // Compute budget alignment
  const totalBudgeted = (budgets || []).reduce((s, b) => s + b.monthly_limit, 0);
  const totalSpent = (summary || []).reduce((s, r) => s + r.actual, 0);
  const unallocated = (income || 0) - totalBudgeted;
  const debtBudgetCategory = (budgets || []).find(b =>
    b.category.toLowerCase().includes("debt")
  );
  const debtBudgetLimit = debtBudgetCategory?.monthly_limit || 0;

  const maxExtra = Math.min(income ? income * 0.25 : 500, 1500);

  async function save() {
    setSaving(true);
    try {
      await setExtraDebtPayment(value);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  // Alignment status
  const gap = value - Math.max(debtBudgetLimit - 0, 0) - unallocated;
  const isOverBudget = value > 0 && unallocated < 0 && !debtBudgetCategory;
  const needsBudgetIncrease = debtBudgetLimit > 0 && value > debtBudgetLimit;

  return (
    <div className="bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-100 rounded-xl p-5 space-y-3 shadow-sm">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-gray-700">Extra Monthly Payment Budget</h3>
        <span className="text-lg font-bold text-emerald-700">${value.toFixed(0)}/mo</span>
      </div>
      <p className="text-xs text-gray-500">
        This extra amount goes straight to your <strong>snowball target</strong> every month, on top of all minimum payments.
      </p>

      {/* Budget context */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-white rounded-lg p-2 text-center border">
          <p className="text-gray-400">Income</p>
          <p className="font-semibold text-gray-700">${(income || 0).toLocaleString()}/mo</p>
        </div>
        <div className="bg-white rounded-lg p-2 text-center border">
          <p className="text-gray-400">Debt Budget</p>
          <p className="font-semibold text-blue-600">${debtBudgetLimit.toLocaleString()}/mo</p>
        </div>
        <div className={`rounded-lg p-2 text-center border ${
          unallocated >= 0 ? "bg-white" : "bg-red-50 border-red-200"
        }`}>
          <p className="text-gray-400">Unallocated</p>
          <p className={`font-semibold ${unallocated >= 0 ? "text-emerald-600" : "text-red-500"}`}>
            ${Math.abs(unallocated).toLocaleString()}{unallocated < 0 ? " over" : ""}
          </p>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={maxExtra}
        step={5}
        value={value}
        onChange={e => setValue(Number(e.target.value))}
        className="w-full accent-blue-600"
      />
      <div className="flex justify-between text-xs text-gray-400">
        <span>$0</span>
        <span>${maxExtra.toFixed(0)}/mo max</span>
      </div>

      {/* Alignment warnings */}
      {needsBudgetIncrease && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
          ⚠️ Your extra payment (${value}/mo) exceeds your &quot;{debtBudgetCategory.category}&quot; budget (${debtBudgetLimit}/mo).
          {unallocated >= value - debtBudgetLimit
            ? ` You have $${unallocated.toFixed(0)} unallocated — raise your Debt Payments budget by $${(value - debtBudgetLimit).toFixed(0)} to align.`
            : ` Consider reducing another category to free up funds.`
          }
        </div>
      )}
      {!debtBudgetCategory && value > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
          💡 Tip: Add a <strong>Debt Payments</strong> budget category to track this ${value}/mo in your Budget tab.
        </div>
      )}

      <button
        onClick={save}
        disabled={saving || value === currentExtra}
        className="w-full bg-emerald-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors"
      >
        {saving ? "Saving…" : value === currentExtra ? "Extra Payment Applied" : "Apply Extra Payment"}
      </button>
    </div>
  );
}

// ── Auto Fix Button ───────────────────────────────────────────────────────────
function AutoFixButton({ label, category, newLimit, budgetType, onFixed }) {
  const [status, setStatus] = useState("idle"); // idle | fixing | done | error

  async function handleFix() {
    setStatus("fixing");
    try {
      await updateBudget(category, newLimit, budgetType);
      setStatus("done");
      setTimeout(() => {
        onFixed();
      }, 800);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }

  if (status === "done") {
    return (
      <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
        ✅ Fixed!
      </span>
    );
  }
  if (status === "error") {
    return <span className="text-xs text-red-500">Failed — try again</span>;
  }

  return (
    <button
      onClick={handleFix}
      disabled={status === "fixing"}
      className="ml-3 shrink-0 text-xs font-semibold bg-emerald-600 text-white px-3 py-1.5 rounded-full hover:bg-emerald-700 disabled:opacity-60 transition-colors flex items-center gap-1"
    >
      {status === "fixing" ? (
        <><span className="animate-spin">⟳</span> Fixing…</>
      ) : (
        <>⚡ {label}</>
      )}
    </button>
  );
}

// ── Main Debts Component ──────────────────────────────────────────────────────
export default function Debts({ appState, onStateChange, onAskCoach }) {
  const [advice, setAdvice] = useState(null);
  const [coachOpen, setCoachOpen] = useState(true);

  const debts = appState?.debts || [];
  const extraPayment = appState?.extra_debt_payment || 0;
  const totalMonths = appState?.total_debt_months || 0;
  const totalInterest = appState?.total_debt_interest || 0;
  const income = appState?.income || 0;
  const budgets = appState?.budgets || [];
  const summary = appState?.summary || [];
  const notifications = appState?.notifications || [];
  const debtAlerts = notifications.filter(n => n.type === "debt_budget_gap");

  const chartData = debts.length > 0 ? buildPaydownData(debts, extraPayment) : [];

  useEffect(() => {
    getDebtAdvice().then(({ data }) => setAdvice(data.advice)).catch(() => {});
  }, []);

  return (
    <div className="overflow-y-auto h-full px-6 py-5 space-y-5">

      {/* Coach Says – Collapsible */}
      {advice && (
        <div className="bg-gradient-to-r from-blue-50 to-emerald-50 border border-blue-100 rounded-xl shadow-sm overflow-hidden">
          <button
            onClick={() => setCoachOpen(o => !o)}
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-blue-50/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">🎓</span>
              <span className="text-sm font-bold text-gray-800">Coach Strategy: Debt Snowball</span>
            </div>
            <span className="text-gray-400 text-sm">{coachOpen ? "▲ Collapse" : "▼ Expand"}</span>
          </button>
          {coachOpen && (
            <div className="px-5 pb-4 text-sm text-gray-700 leading-relaxed max-h-60 overflow-y-auto">
              <ExpandableMessage text={advice} />
            </div>
          )}
        </div>
      )}

      {/* Extra Payment Panel */}
      <ExtraPaymentPanel
        currentExtra={extraPayment}
        income={income}
        budgets={budgets}
        summary={summary}
        onSaved={onStateChange}
      />

      {/* Budget Alignment Alerts — with Auto Fix */}
      {debtAlerts.length > 0 && (() => {
        // Compute the fix: find the debt budget category and required new limit
        const debtBudgetCat = budgets.find(b => b.category.toLowerCase().includes("debt"));
        const minPayments = debts.reduce((s, d) => s + (d.minimum_payment || 0), 0);
        const totalNeeded = minPayments + extraPayment;
        const totalBudgeted = budgets.reduce((s, b) => s + b.monthly_limit, 0);
        const unallocated = income - totalBudgeted;
        const canAutoFix = debtBudgetCat && totalNeeded > debtBudgetCat.monthly_limit;
        const gap = canAutoFix ? totalNeeded - debtBudgetCat.monthly_limit : 0;
        const canCoverFromUnallocated = unallocated >= gap;

        return (
          <div>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Budget Alignment</h2>
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-4 space-y-3">
              <div className="flex items-start gap-3">
                <span className="text-xl shrink-0">⚠️</span>
                <p className="text-sm text-amber-800 leading-relaxed">{debtAlerts[0].message}</p>
              </div>

              {onAskCoach && (
                <button
                  onClick={() => onAskCoach("My debt payment strategy isn't aligned with my budget. Help me figure out how to fix this.")}
                  className="text-xs font-semibold bg-blue-600 text-white px-3 py-1.5 rounded-full hover:bg-blue-700 transition-colors"
                >
                  💬 Ask Coach
                </button>
              )}
              {canAutoFix && (
                <div className="border-t border-amber-200 pt-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-700">Suggested Fix:</p>
                  <div className="flex items-center justify-between bg-white border border-amber-200 rounded-lg px-3 py-2">
                    <div className="text-xs text-gray-600">
                      Raise <strong>"{debtBudgetCat.category}"</strong> from{" "}
                      <strong>${debtBudgetCat.monthly_limit.toFixed(0)}/mo</strong>{" "}
                      → <strong className="text-emerald-700">${totalNeeded.toFixed(0)}/mo</strong>
                      {" "}(+${gap.toFixed(0)})
                    </div>
                    <AutoFixButton
                      label={canCoverFromUnallocated
                        ? `Auto Fix — use $${gap.toFixed(0)} unallocated`
                        : `Auto Fix — reallocate $${gap.toFixed(0)}`
                      }
                      category={debtBudgetCat.category}
                      newLimit={totalNeeded}
                      budgetType={debtBudgetCat.type || "savings"}
                      onFixed={onStateChange}
                    />
                  </div>
                  {!canCoverFromUnallocated && (
                    <p className="text-xs text-amber-600">
                      ⚠️ Only ${Math.max(0, unallocated).toFixed(0)} unallocated — you may need to reduce another category first.
                    </p>
                  )}
                </div>
              )}

              {!debtBudgetCat && (
                <div className="border-t border-amber-200 pt-3">
                  <p className="text-xs text-amber-700">
                    💡 No "Debt Payments" category found. Ask your coach to add one, or go to the Budget tab and add a Savings subcategory called "Debt Payments" for ${totalNeeded.toFixed(0)}/mo.
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Summary Stats */}
      {debts.length > 0 && totalMonths > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border rounded-xl p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Debts</p>
            <p className="text-xl font-bold text-gray-800">{debts.length}</p>
          </div>
          <div className="bg-white border rounded-xl p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Debt-Free In</p>
            <p className="text-xl font-bold text-emerald-600">{fmtMo(totalMonths)}</p>
          </div>
          <div className="bg-white border rounded-xl p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Total Interest</p>
            <p className="text-xl font-bold text-red-500">{fmt(totalInterest)}</p>
          </div>
        </div>
      )}

      {/* Add Debt Form */}
      <AddDebtForm onAdded={onStateChange} />

      {/* Debt Cards / Snowball Order */}
      {debts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
          <div className="text-4xl">💳</div>
          <p className="text-sm text-gray-500">No debts added yet.</p>
          <p className="text-xs text-gray-400">Add one above, or tell your coach about a debt in chat.</p>
        </div>
      ) : (
        <>
          <div>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Snowball Order (Smallest Balance First)</h2>
            <div className="space-y-3">
              {debts.map((d, i) => <DebtCard key={d.id ?? d.name} debt={d} rank={i} onSaved={onStateChange} />)}
            </div>
          </div>

          {/* Paydown chart */}
          {chartData.length > 1 && (
            <div>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Balance Paydown Projection</h2>
              <div className="bg-white border rounded-xl p-4 shadow-sm">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={v => `Mo ${v}`} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} width={70} />
                    <Tooltip formatter={v => fmt(v)} labelFormatter={v => `Month ${v}`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {debts.map((d, i) => (
                      <Line
                        key={d.name}
                        type="monotone"
                        dataKey={d.name}
                        stroke={LINE_COLORS[i % LINE_COLORS.length]}
                        dot={false}
                        strokeWidth={2}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
