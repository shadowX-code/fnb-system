import Card from "../../../components/ui/Card.jsx";

export default function SummaryPanel({ title = "Summary", items, children }) {
  return (
    <Card title={title}>
      <div className="divide-y divide-border">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="text-text-secondary">{item.label}</span>
            <span className={`font-bold ${item.tone === "danger" ? "text-rose-600" : "text-text-primary"}`}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
      {children ? <div className="border-t border-border p-4">{children}</div> : null}
    </Card>
  );
}
