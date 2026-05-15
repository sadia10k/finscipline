import { useState } from "react";
import api from "../api/client";

export default function TransactionForm({ onAdded }) {
  const [form, setForm] = useState({ amount: "", category: "", date: "", note: "" });

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    await api.post("/transactions", {
      amount: parseFloat(form.amount),
      category: form.category,
      date: form.date,
      note: form.note,
    });
    setForm({ amount: "", category: "", date: "", note: "" });
    onAdded?.();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input name="amount" type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2 text-sm" />
      <input name="category" type="text" placeholder="Category" value={form.category} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2 text-sm" />
      <input name="date" type="date" value={form.date} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2 text-sm" />
      <input name="note" type="text" placeholder="Note (optional)" value={form.note} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm" />
      <button type="submit" className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700">
        Add Transaction
      </button>
    </form>
  );
}
