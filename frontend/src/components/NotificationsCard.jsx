import { Markdown } from "./Chat";

const SEVERITY_STYLES = {
  warning: { bg: "bg-red-50 border-red-200",  icon: "⚠️", text: "text-red-700" },
  info:    { bg: "bg-blue-50 border-blue-200", icon: "💡", text: "text-blue-700" },
};

export function ExpandableMessage({ text, className }) {
  const isLong = text.length > 220;
  return (
    <div className={`${isLong ? "max-h-36 overflow-y-auto pr-1" : ""} ${className ?? ""}`}>
      <Markdown text={text} />
    </div>
  );
}

export function NotificationsCard({ notifications, fallback = "All good — no alerts right now." }) {
  if (!notifications || notifications.length === 0) {
    return (
      <div className="bg-white border rounded-xl p-4 flex items-center gap-3">
        <span className="text-2xl">✅</span>
        <p className="text-sm text-gray-600">{fallback}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 w-full">
      {notifications.map((n, i) => {
        const s = SEVERITY_STYLES[n.severity] || SEVERITY_STYLES.info;
        return (
          <div key={i} className={`border rounded-xl px-4 py-4 flex items-start gap-4 ${s.bg}`}>
            <span className="text-2xl mt-0.5 shrink-0">{s.icon}</span>
            <div className={`text-sm leading-relaxed ${s.text} w-full`}>
              <ExpandableMessage text={n.message} className="w-full break-words" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
