import axios from "axios";

const api = axios.create({ baseURL: "/api", withCredentials: true });

export const authRegister = (username, passphrase) =>
  api.post("/auth/register", { username, passphrase });

export const authLogin = (username, passphrase) =>
  api.post("/auth/login", { username, passphrase });

export const authLogout = () =>
  api.post("/auth/logout");

export const authMe = () =>
  api.get("/auth/me");

export const authChangePassword = (current_passphrase, new_passphrase) =>
  api.post("/auth/change-password", { current_passphrase, new_passphrase });

export const authResetPassword = (username, recovery_code, new_passphrase) =>
  api.post("/auth/reset-password", { username, recovery_code, new_passphrase });

export const sendMessage = (messages, active_tab) =>
  api.post("/chat", { messages, active_tab });

// Single source of truth for all right-panel data
export const getAppState = () =>
  api.get("/state");

export const getTransactions = () =>
  api.get("/transactions");

export const addTransaction = (amount, category, date, note, merchant) =>
  api.post("/transactions", { amount, category, date, note: note || "", merchant: merchant || "" });

export const deleteTransaction = (id) =>
  api.delete(`/transactions/${id}`);

export const updateTransaction = (id, amount, category, date, note, merchant) =>
  api.patch(`/transactions/${id}`, { amount, category, date, note: note || "", merchant: merchant || "" });

export const updateBudget = (category, monthly_limit, type) =>
  api.patch(`/budget/${encodeURIComponent(category)}`, { monthly_limit, type });

export const deleteBudgetCategory = (category) =>
  api.delete(`/budget/${encodeURIComponent(category)}`);

export const getBudgetSuggestions = () =>
  api.get("/budget/suggestions");

export const addDebt = (name, balance, rate, minimum_payment) =>
  api.post("/debts", { name, balance, rate, minimum_payment });

export const updateDebt = (id, name, balance, rate, minimum_payment) =>
  api.patch(`/debts/${id}`, { name, balance, rate, minimum_payment });

export const deleteDebt = (id) =>
  api.delete(`/debts/${id}`);

export const getDebtAdvice = () =>
  api.get("/debts/advice");

export const setExtraDebtPayment = (amount) =>
  api.patch("/debts/extra", { amount });

export default api;
