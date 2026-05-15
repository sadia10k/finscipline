import { useState, useEffect } from "react";
import { getTransactions, deleteTransaction, addTransaction, updateTransaction } from "../api/client";

function fmt(n) {
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const TYPE_LABELS = { needs: "Needs", wants: "Wants", savings: "Savings" };
const TYPE_BADGE = {
  needs:   "bg-blue-100 text-blue-700",
  wants:   "bg-purple-100 text-purple-700",
  savings: "bg-emerald-100 text-emerald-700",
};

function AddForm({ budgets, onAdded }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ amount: "", category: "", date: today, note: "", merchant: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(field, val) { setForm((f) => ({ ...f, [field]: val })); }

  const TYPE_KEYWORDS = new Set(["needs", "need", "wants", "want", "savings", "saving"]);
  const subcategoryBudgets = budgets.filter(
    (b) => !TYPE_KEYWORDS.has(b.category.toLowerCase().trim())
  );

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await addTransaction(
        parseFloat(form.amount),
        form.category,
        form.date,
        form.note,
        form.merchant,
      );
      setForm({ amount: "", category: "", date: today, note: "", merchant: "" });
      onAdded();
    } catch (err) {
      setError(err.response?.data?.detail || "Could not save transaction.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-700">Add Transaction</h3>
      <div className="grid grid-cols-2 gap-3">
        <input
          type="number" step="0.01" min="0.01" placeholder="Amount ($)" value={form.amount}
          onChange={(e) => set("amount", e.target.value)} required
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <div className="relative">
          <input
            type="text"
            list="budget-categories"
            placeholder="Category"
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
            required
            autoComplete="off"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <datalist id="budget-categories">
            {subcategoryBudgets.map((b) => (
              <option key={b.category} value={b.category} />
            ))}
          </datalist>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input
          type="date" value={form.date}
          onChange={(e) => set("date", e.target.value)} required
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <input
          type="text" placeholder="Merchant (optional)" value={form.merchant}
          onChange={(e) => set("merchant", e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>
      <input
        type="text" placeholder="Note (optional)" value={form.note}
        onChange={(e) => set("note", e.target.value)}
        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      {error && <p className="text-red-500 text-xs">{error}</p>}
      <button
        type="submit" disabled={saving}
        className="w-full bg-emerald-500 text-white rounded-lg py-2 text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Add Transaction"}
      </button>
    </form>
  );
}

function TransactionRow({ t, budgets, categoryType, onSaved, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ amount: String(t.amount), category: t.category, date: t.date, note: t.note || "" });
  const [saving, setSaving] = useState(false);

  function set(field, val) { setForm((f) => ({ ...f, [field]: val })); }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateTransaction(t.id, parseFloat(form.amount), form.category, form.date, form.note, "");
      setEditing(false);
      onSaved();
    } finally { setSaving(false); }
  }

  function handleCancel() {
    setForm({ amount: String(t.amount), category: t.category, date: t.date, note: t.note || "" });
    setEditing(false);
  }

  const type = categoryType[t.category];

  if (editing) {
    return (
      <form onSubmit={handleSave} className="px-4 py-3 space-y-2 bg-blue-50">
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number" step="0.01" value={form.amount}
            onChange={(e) => set("amount", e.target.value)} required
            className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="Amount"
          />
          <input
            type="text" list={`cats-${t.id}`} value={form.category}
            onChange={(e) => set("category", e.target.value)} required
            className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="Category"
          />
          <datalist id={`cats-${t.id}`}>
            {budgets
              .filter((b) => !new Set(["needs","want","wants","saving","savings"]).has(b.category.toLowerCase().trim()))
              .map((b) => <option key={b.category} value={b.category} />)}
          </datalist>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date" value={form.date}
            onChange={(e) => set("date", e.target.value)} required
            className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <input
            type="text" value={form.note}
            onChange={(e) => set("note", e.target.value)}
            className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="Note"
          />
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={saving}
            className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={handleCancel}
            className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-300">
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 group">
      <div className="space-y-0.5 min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-800">{t.category}</p>
          {type && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${TYPE_BADGE[type] || ""}`}>
              {TYPE_LABELS[type]}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 truncate">{t.note || t.date}</p>
      </div>
      <div className="flex items-center gap-2 ml-4 shrink-0">
        <span className="text-sm font-semibold text-gray-700">{fmt(t.amount)}</span>
        <button onClick={() => setEditing(true)}
          className="text-gray-300 hover:text-blue-500 transition-colors text-xs opacity-0 group-hover:opacity-100"
          title="Edit">
          ✏️
        </button>
        <button onClick={() => onDeleted(t.id)}
          className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
          title="Delete">
          ×
        </button>
      </div>
    </div>
  );
}

export default function Spending({ appState, onStateChange }) {
  const [transactions, setTransactions] = useState(null);

  const budgets = appState?.budgets || [];

  async function load() {
    const { data } = await getTransactions();
    setTransactions(data.transactions || []);
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id) {
    await deleteTransaction(id);
    load();
    onStateChange?.();
  }

  function handleSaved() {
    load();
    onStateChange?.();
  }

  function handleAdded() {
    load();
    onStateChange?.();
  }

  if (transactions === null) {
    return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading…</div>;
  }

  const categoryType = {};
  for (const b of budgets) categoryType[b.category] = b.type;

  const grouped = {};
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    if (!grouped[month]) grouped[month] = [];
    grouped[month].push(t);
  }
  const months = Object.keys(grouped).sort().reverse();

  return (
    <div className="overflow-y-auto h-full px-6 py-5 space-y-5">
      <AddForm budgets={budgets} onAdded={handleAdded} />

      {transactions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
          <div className="text-4xl">🧾</div>
          <p className="text-sm text-gray-500">No transactions yet.</p>
          <p className="text-xs text-gray-400">
            Add one above, or tell your coach "I spent $40 on groceries."
          </p>
        </div>
      ) : (
        months.map((month) => {
          const label = new Date(month + "-02").toLocaleString("default", { month: "long", year: "numeric" });
          const monthTotal = grouped[month].reduce((s, t) => s + t.amount, 0);
          return (
            <div key={month}>
              <div className="flex justify-between items-baseline mb-2">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</h2>
                <span className="text-xs text-gray-400">{fmt(monthTotal)} total</span>
              </div>
              <div className="bg-white border rounded-xl overflow-hidden divide-y">
                {grouped[month].map((t) => (
                  <TransactionRow
                    key={t.id}
                    t={t}
                    budgets={budgets}
                    categoryType={categoryType}
                    onSaved={handleSaved}
                    onDeleted={handleDelete}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
