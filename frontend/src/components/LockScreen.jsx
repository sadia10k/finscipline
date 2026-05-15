import { useState } from "react";
import {
  authLogin,
  authRegister,
  authResetPassword,
} from "../api/client";

const VIEWS = { LOGIN: "login", REGISTER: "register", FORGOT: "forgot" };

export default function LockScreen({ onSuccess }) {
  const [view, setView] = useState(VIEWS.LOGIN);
  const [username, setUsername] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Shown once after successful registration — user must acknowledge before proceeding
  const [savedRecoveryCode, setSavedRecoveryCode] = useState(null);

  function switchView(v) {
    setUsername("");
    setPassphrase("");
    setNewPassphrase("");
    setRecoveryCode("");
    setError("");
    setLoading(false);
    setView(v);
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await authLogin(username, passphrase);
      onSuccess(data.username || username);
    } catch (err) {
      setError(err.response?.data?.detail || "Invalid username or passphrase.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await authRegister(username, passphrase);
      setSavedRecoveryCode({ code: data.recovery_code, username: data.username || username });
    } catch (err) {
      setError(err.response?.data?.detail || "Could not create account.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authResetPassword(username, recoveryCode, newPassphrase);
      switchView(VIEWS.LOGIN);
    } catch (err) {
      setError(err.response?.data?.detail || "Invalid username or recovery code.");
    } finally {
      setLoading(false);
    }
  }

  // Step shown once after registration — user must save their recovery code first
  if (savedRecoveryCode) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="bg-white p-8 rounded-2xl shadow-md w-96 space-y-4">
          <h1 className="text-xl font-semibold text-gray-800">Account created!</h1>
          <p className="text-sm text-gray-600">
            Save your recovery code somewhere safe. If you ever forget your passphrase,
            you'll need this to reset it.{" "}
            <strong>It will not be shown again.</strong>
          </p>
          <div className="bg-gray-100 rounded-lg p-3 font-mono text-sm text-gray-800 break-all select-all">
            {savedRecoveryCode.code}
          </div>
          <button
            onClick={() => { setSavedRecoveryCode(null); onSuccess(savedRecoveryCode.username); }}
            className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700"
          >
            I've saved my recovery code — Continue
          </button>
        </div>
      </div>
    );
  }

  if (view === VIEWS.REGISTER) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <form onSubmit={handleRegister} className="bg-white p-8 rounded-2xl shadow-md w-80 space-y-4">
          <h1 className="text-3xl font-black tracking-widest text-center uppercase bg-gradient-to-r from-blue-600 to-emerald-500 bg-clip-text text-transparent">
            Finscipline
          </h1>
          <p className="text-sm text-gray-500 text-center">Create a new account.</p>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            autoFocus
            required
          />
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Passphrase"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            required
          />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Creating…" : "Create Account"}
          </button>
          <button
            type="button"
            onClick={() => switchView(VIEWS.LOGIN)}
            className="w-full text-xs text-gray-400 hover:text-gray-600"
          >
            Already have an account? Sign in
          </button>
        </form>
      </div>
    );
  }

  if (view === VIEWS.FORGOT) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <form onSubmit={handleReset} className="bg-white p-8 rounded-2xl shadow-md w-80 space-y-4">
          <h1 className="text-xl font-semibold text-gray-800">Reset Passphrase</h1>
          <p className="text-sm text-gray-500">
            Enter your username and the recovery code you saved when you created your account.
          </p>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            autoFocus
            required
          />
          <input
            type="text"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            placeholder="Recovery code"
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            required
          />
          <input
            type="password"
            value={newPassphrase}
            onChange={(e) => setNewPassphrase(e.target.value)}
            placeholder="New passphrase"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            required
          />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Resetting…" : "Reset Passphrase"}
          </button>
          <button
            type="button"
            onClick={() => switchView(VIEWS.LOGIN)}
            className="w-full text-xs text-gray-400 hover:text-gray-600"
          >
            Back to sign in
          </button>
        </form>
      </div>
    );
  }

  // Default: login view
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <form onSubmit={handleLogin} className="bg-white p-8 rounded-2xl shadow-md w-80 space-y-4">
        <h1 className="text-3xl font-black tracking-widest text-center uppercase bg-gradient-to-r from-blue-600 to-emerald-500 bg-clip-text text-transparent">
          Finscipline
        </h1>
        <p className="text-sm text-gray-500 text-center">Sign in or sign up to continue.</p>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          autoFocus
          required
        />
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          required
        />
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign In"}
        </button>
        <button
          type="button"
          onClick={() => switchView(VIEWS.REGISTER)}
          className="w-full bg-emerald-500 text-white rounded-lg py-2 text-sm font-medium hover:bg-emerald-600"
        >
          Sign Up
        </button>
        <p className="text-center text-xs text-gray-400">
          <button
            type="button"
            onClick={() => switchView(VIEWS.FORGOT)}
            className="hover:text-gray-600 underline"
          >
            Forgot passphrase?
          </button>
        </p>
      </form>
    </div>
  );
}
