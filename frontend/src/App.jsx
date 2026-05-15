import { useState, useCallback, useEffect } from "react";
import LockScreen from "./components/LockScreen";
import Chat from "./components/Chat";
import BudgetSetup from "./components/BudgetSetup";
import Dashboard from "./components/Dashboard";
import Budget from "./components/Budget";
import Spending from "./components/Spending";
import Debts from "./components/Debts";
import { authLogout, authMe, getAppState } from "./api/client";

function Logo() {
  return (
    <span className="text-xl font-black tracking-widest uppercase bg-gradient-to-r from-blue-600 to-emerald-500 bg-clip-text text-transparent select-none">
      Finscipline
    </span>
  );
}

function NavBtn({ id, label, icon, active, onClick }) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`flex items-center gap-2 px-5 py-3 border-b-2 text-sm font-medium transition-all ${
        active
          ? "border-blue-600 text-blue-600 bg-blue-50/50"
          : "border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300"
      }`}
    >
      <span className="text-lg">{icon}</span>
      {label}
    </button>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [appState, setAppState] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [chatOpen, setChatOpen] = useState(true);
  const [autoPrompt, setAutoPrompt] = useState(null);

  // Check auth on mount
  useEffect(() => {
    authMe()
      .then(({ data }) => {
        setUsername(data.username);
        setAuthenticated(true);
        refreshState();
      })
      .catch(() => setAuthenticated(false));
  }, []);

  const refreshState = useCallback(() => {
    getAppState()
      .then(({ data }) => setAppState(data))
      .catch(() => {});
  }, []);

  function handleAuthSuccess(name) {
    setUsername(name);
    setAuthenticated(true);
    refreshState();
  }

  function handleAskCoach(prompt) {
    setChatOpen(true);
    setAutoPrompt(prompt);
  }

  async function handleSignOut() {
    await authLogout();
    setAuthenticated(false);
    setUsername("");
    setAppState(null);
    setActiveTab("dashboard");
  }

  if (!authenticated) {
    return <LockScreen onSuccess={handleAuthSuccess} />;
  }

  const phase = appState?.has_budget ? "active" : "onboarding";

  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "budget",    label: "Budget",    icon: "🎯" },
    { id: "spending",  label: "Transactions", icon: "🧾" },
    { id: "debts",     label: "Debts",     icon: "💳" },
  ];

  const safeTab = tabs.find((t) => t.id === activeTab) ? activeTab : "dashboard";

  const handleTabChange = (id) => {
    setActiveTab(id);
    if (id === "dashboard") {
      refreshState();
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-100">
      {/* ── Top Header ── */}
      <header className="bg-white border-b px-6 flex items-center justify-between shrink-0 h-16 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <Logo />
          <div className="w-px h-6 bg-gray-200 mx-2" />
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              chatOpen ? "bg-blue-50 text-blue-600" : "hover:bg-gray-100 text-gray-600"
            }`}
          >
            {chatOpen ? "Hide Chat" : "Show Chat"}
          </button>
        </div>
        
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700 bg-gray-100 px-3 py-1 rounded-full">
            {username}
          </span>
          <button
            onClick={handleSignOut}
            className="text-sm font-medium text-red-500 hover:text-red-600 hover:underline"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ── Main Content Area ── */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Left: Chat Sidebar */}
        <div className={`w-[380px] shrink-0 border-r flex flex-col bg-white shadow-sm min-h-0 transition-all duration-300 ${chatOpen ? "" : "hidden"}`}>
          <Chat
            appState={appState}
            username={username}
            onStateChange={refreshState}
            activeTab={safeTab}
            autoPrompt={autoPrompt}
            onPromptConsumed={() => setAutoPrompt(null)}
          />
        </div>

        {/* Center/Right: App Content */}
        <div className="flex flex-col flex-1 min-h-0 bg-white shadow-xl z-0">
          {/* Top Navigation Tabs */}
          <div className="flex px-4 border-b bg-gray-50/50 shrink-0">
            {phase === "active" ? (
              tabs.map((t) => (
                <NavBtn
                  key={t.id}
                  id={t.id}
                  label={t.label}
                  icon={t.icon}
                  active={safeTab === t.id}
                  onClick={handleTabChange}
                />
              ))
            ) : (
              <div className="text-sm font-medium text-gray-500 py-3 px-4">
                🧭 Complete setup to unlock navigation
              </div>
            )}
          </div>

          {/* Right: Dynamic Tab Content */}
          <div className="flex-1 min-h-0 overflow-y-auto bg-white">
            {phase === "onboarding" && (
              <BudgetSetup appState={appState} username={username} onStateChange={refreshState} />
            )}
            {phase === "active" && safeTab === "dashboard" && (
              <Dashboard
                appState={appState}
                onGoToSpending={() => setActiveTab("spending")}
                onGoToDebts={() => setActiveTab("debts")}
                onAskCoach={handleAskCoach}
              />
            )}
            {phase === "active" && safeTab === "budget" && (
              <Budget appState={appState} onStateChange={refreshState} onAskCoach={handleAskCoach} />
            )}
            {phase === "active" && safeTab === "spending" && (
              <Spending appState={appState} onStateChange={refreshState} />
            )}
            {phase === "active" && safeTab === "debts" && (
              <Debts appState={appState} onStateChange={refreshState} onAskCoach={handleAskCoach} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
