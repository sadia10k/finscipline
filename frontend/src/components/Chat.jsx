import { useState, useRef, useEffect } from "react";
import { sendMessage } from "../api/client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SUGGEST_RE = /<!--\s*SUGGEST:\s*(.+?)\s*-->/s;

export function parseSuggestions(text) {
  if (typeof text !== "string") return { body: text, suggestions: [] };
  const m = text.match(SUGGEST_RE);
  if (!m) return { body: text, suggestions: [] };
  const suggestions = m[1].split("|").map((s) => s.trim()).filter(Boolean);
  const body = text.replace(SUGGEST_RE, "").trim();
  return { body, suggestions };
}

export function Markdown({ text }) {
  if (typeof text !== "string") return null;
  const { body } = parseSuggestions(text);
  return (
    <div className="prose prose-sm max-w-none break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({node, ...props}) => <div className="overflow-x-auto my-2 w-full"><table className="min-w-full divide-y divide-gray-200 border" {...props} /></div>,
          thead: ({node, ...props}) => <thead className="bg-gray-50" {...props} />,
          th: ({node, ...props}) => <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b" {...props} />,
          td: ({node, ...props}) => <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-700 border-b" {...props} />
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

function getWelcomeContent(appState, username, activeTab) {
  if (!appState) return null;

  const name = username ? `, ${username}` : "";

  if (!appState.has_budget) {
    return {
      emoji: "👋",
      heading: `Welcome${name}!`,
      body: "The first step is setting up your budget. Just tell me how much you take home each month and I'll handle the rest.",
      starters: [
        "I want to set up my monthly budget",
        "I take home $4,500 a month after taxes",
      ],
      cta: "Let's set up your budget →",
      ctaPrompt: "I want to set up my monthly budget",
    };
  }

  if (!appState.has_transactions) {
    return {
      emoji: "🎉",
      heading: "Budget ready — now let's track your spending",
      body: "Your budget is set up. Start logging transactions as you spend and I'll track how you're doing.",
      starters: [
        "I spent $67 at Trader Joe's on groceries",
        "I paid $1,200 for rent",
        "Show me my budget",
        "I bought a $15 book — put it under entertainment",
      ],
      cta: null,
    };
  }

  let starters = [];
  if (activeTab === "debts") {
    starters = [
      "How long until I'm debt-free?",
      "What is the debt snowball method?",
      "I have a credit card with a $2,500 balance at 19% APR",
      "Which debt should I pay off first?"
    ];
  } else if (activeTab === "budget") {
    starters = [
      "Show me my budget summary",
      "Set my dining budget to $300",
      "Am I over budget anywhere?",
      "How do I build an emergency fund?"
    ];
  } else if (activeTab === "spending") {
    starters = [
      "Where am I spending the most?",
      "I spent $47 at Costco on groceries",
      "I paid $1,200 for rent",
      "Show me my spending by category"
    ];
  } else {
    // dashboard default
    starters = [
      "How am I doing on my budget this month?",
      "Am I over budget anywhere?",
      "I spent $47 at Costco on groceries",
      "How do I build an emergency fund?"
    ];
  }

  return {
    emoji: "📊",
    heading: `Welcome back${name}!`,
    body: null,
    starters: starters.slice(0, 4),
    cta: null,
  };
}

function WelcomeScreen({ appState, username, onStarter, activeTab }) {
  const content = getWelcomeContent(appState, username, activeTab);

  if (!content) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-400 text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center space-y-6 max-w-md mx-auto">
      <div className="text-5xl">{content.emoji}</div>

      <div className="space-y-2">
        <h2 className="text-xl font-bold text-gray-800">{content.heading}</h2>
        {content.body && (
          <p className="text-gray-500 text-sm leading-relaxed">{content.body}</p>
        )}
      </div>

      {content.cta && (
        <button
          onClick={() => onStarter(content.ctaPrompt)}
          className="w-full bg-gradient-to-r from-blue-600 to-emerald-500 text-white font-semibold rounded-xl px-6 py-3 text-sm hover:opacity-90 transition-opacity shadow-md"
        >
          {content.cta}
        </button>
      )}

      <div className="w-full space-y-2">
        {!content.cta && (
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Try saying…
          </p>
        )}
        {content.starters.map((s) => (
          <button
            key={s}
            onClick={() => onStarter(s)}
            className="w-full text-left bg-white border border-gray-200 hover:border-blue-400 hover:bg-blue-50 rounded-xl px-4 py-3 text-sm text-gray-700 transition-colors shadow-sm"
          >
            "{s}"
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Chat({ appState, username, onStateChange, activeTab, autoPrompt, onPromptConsumed }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-send a prompt injected from outside (e.g. "Ask Coach" buttons)
  useEffect(() => {
    if (autoPrompt && !loading) {
      onPromptConsumed?.();
      send(autoPrompt);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrompt]);

  async function send(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg = { role: "user", content: trimmed };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setLoading(true);
    inputRef.current?.focus();

    try {
      const { data } = await sendMessage(updated, activeTab);
      setMessages([...updated, { role: "assistant", content: data.reply }]);
      if (data.tools_called?.length > 0) {
        onStateChange?.();
      }
    } catch {
      setMessages([...updated, { role: "assistant", content: "Something went wrong. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    send(input);
  }

  const isEmpty = messages.length === 0;

  // Extract suggestions from the last assistant message (only when not loading)
  const lastAssistant = !loading && [...messages].reverse().find((m) => m.role === "assistant");
  const { suggestions } = lastAssistant ? parseSuggestions(lastAssistant.content) : { suggestions: [] };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {isEmpty ? (
          <WelcomeScreen appState={appState} username={username} onStarter={send} activeTab={activeTab} />
        ) : (
          <>
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setMessages([])}
                className="text-xs text-gray-400 hover:text-gray-700 underline"
              >
                Clear Chat
              </button>
            </div>
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-lg px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-white border shadow-sm text-gray-800"
                }`}>
                  {m.role === "assistant"
                    ? <Markdown text={m.content} />
                    : m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border shadow-sm rounded-2xl px-4 py-3 text-sm text-gray-400">
                  Thinking…
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick-reply chips from agent suggestions */}
      {suggestions.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={loading}
              className="text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-3 py-1.5 hover:bg-blue-100 hover:border-blue-400 transition-colors disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white border-t px-6 py-3 flex gap-3 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] shrink-0"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={!appState?.has_budget
            ? "Tell me how much you take home each month…"
            : "Ask about your budget, log a transaction…"}
          className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 focus:bg-white transition-colors"
          disabled={loading}
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-blue-600 text-white rounded-xl px-5 py-3 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
