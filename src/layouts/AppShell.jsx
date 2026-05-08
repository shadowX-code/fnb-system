import { BarChart3, Building2, ClipboardList, Download, Settings } from "lucide-react";
import Badge from "../components/ui/Badge.jsx";

const iconMap = {
  dashboard: BarChart3,
  "sales-input": ClipboardList,
  "sales-comparison": BarChart3,
  "purchase-input": ClipboardList,
  "purchase-comparison": BarChart3,
  suppliers: Building2,
  outlets: Building2,
  settings: Settings,
  alerts: BarChart3,
  "data-import": Download,
  "data-health": BarChart3,
};

export default function AppShell({ activeRoute, activeRouteId, sections, onNavigate, children, store }) {
  const latestUpdate = [...store.salesRecords, ...store.purchaseRecords]
    .map((record) => record.updated_at)
    .sort()
    .at(-1);

  return (
    <div className="min-h-screen bg-app-bg text-text-primary">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-border bg-white lg:flex lg:flex-col">
        <div className="flex h-16 items-center gap-3 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
            <BarChart3 size={18} />
          </div>
          <div>
            <div className="text-sm font-bold text-text-primary">F&B Ops</div>
            <div className="text-xs text-text-secondary">Intelligence</div>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
          {sections.map((section) => (
            <div key={section.label}>
              <div className="mb-2 flex items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                <span>{section.label}</span>
                {section.items.length > 1 ? <span className="text-xs">⌄</span> : null}
              </div>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = iconMap[item.id] ?? ClipboardList;
                  const active = activeRouteId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onNavigate(item.id)}
                      className={`flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition ${
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-text-secondary hover:bg-slate-50 hover:text-text-primary"
                      }`}
                    >
                      <Icon size={16} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-4">
          <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
            <div className="h-9 w-9 rounded-full bg-slate-900" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">Marcus Lee</div>
              <div className="text-xs text-text-secondary">Owner</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 border-b border-border bg-app-bg/95 backdrop-blur">
          <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                Sales & Purchase Management
              </div>
              <h1 className="truncate text-lg font-bold text-text-primary">{activeRoute.label}</h1>
            </div>
            <div className="hidden min-w-[320px] items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-secondary shadow-sm md:flex">
              <span className="text-text-muted">⌕</span>
              <span>Search records, suppliers, outlets...</span>
            </div>
            <div className="hidden items-center gap-2 xl:flex">
              <Badge tone="success">
                <span className="inline-flex items-center gap-1">Data Healthy</span>
              </Badge>
              <span className="text-xs font-medium text-text-secondary">
                Updated {latestUpdate ? new Date(latestUpdate).toLocaleDateString() : "today"}
              </span>
            </div>
            <button className="icon-btn relative" type="button" aria-label="Notifications">
              <span className="text-sm font-bold">!</span>
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500" />
            </button>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[1440px]">
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{activeRoute.eyebrow}</p>
              <p className="mt-1 max-w-3xl text-sm text-text-secondary">{activeRoute.description}</p>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
