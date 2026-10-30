import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Plus, Printer } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import {
  FactoryDataSurface,
  FactoryTable,
} from "../components/FactoryDataDisplay.jsx";
import FactoryPagination from "../components/FactoryPagination.jsx";
import FactorySegmentedControl from "../components/FactorySegmentedControl.jsx";
import FactoryFilterBar from "../components/FactoryFilterBar.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import {
  factoryLabelService,
  factoryLabelsEnabled,
} from "../../../services/factoryLabelService.js";
import FactoryLabelEditorPage from "../labels/FactoryLabelEditorPage.jsx";
import {
  openLabelManagement,
  readLabelManagementLocation,
} from "../labels/labelManagementNavigation.js";

export default function FactoryLabelManagementPage({ onConfirm }) {
  const { can } = useFactoryPermissions(),
    canEdit = can("factory_finished_goods.edit");
  const [location, setLocation] = useState(readLabelManagementLocation),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState({ rows: [], total: 0 }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [printer, setPrinter] = useState(null),
    [reason, setReason] = useState(""),
    [saving, setSaving] = useState(false);
  const generation = useRef(0),
    lock = useRef(false);
  useEffect(() => {
    const change = () => {
      setLocation(readLabelManagementLocation());
      setPage(1);
      setSearch("");
    };
    window.addEventListener("popstate", change);
    return () => window.removeEventListener("popstate", change);
  }, []);
  const load = useCallback(async () => {
    if (!factoryLabelsEnabled) return;
    const current = ++generation.current;
    setLoading(true);
    try {
      const next = await factoryLabelService.management(
        location.section,
        page,
        search,
      );
      if (current === generation.current) {
        setData(next);
        setError("");
      }
    } catch (e) {
      if (current === generation.current) setError(e.message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [location.section, page, search]);
  useEffect(() => {
    if (location.sku || location.template) return;
    load();
    return () => {
      generation.current++;
    };
  }, [load, location.sku, location.template]);
  useEffect(() => {
    if (location.section !== "printers" || location.sku || location.template)
      return;
    const timer = setInterval(() => {
      if (!lock.current) load();
    }, 10000);
    return () => clearInterval(timer);
  }, [load, location]);
  if (!factoryLabelsEnabled)
    return (
      <div>
        <PageHeader
          title="Label Management"
          description="Label Management is available on Staging only."
        />
      </div>
    );
  if (location.sku || location.template)
    return (
      <FactoryLabelEditorPage
        key={location.sku || location.template}
        kind={location.sku ? "product" : "template"}
        entityKey={location.sku || location.template}
        canEdit={canEdit}
        onConfirm={onConfirm}
        onBack={() =>
          openLabelManagement({
            section: location.sku ? "products" : "templates",
          })
        }
      />
    );
  async function togglePrinter() {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      await factoryLabelService.setDeviceEnabled(
        printer.id,
        !printer.enabled,
        reason,
      );
      setPrinter(null);
      setReason("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  const columns =
    location.section === "products"
      ? [
          {
            key: "sku",
            label: "Packaging SKU",
            render: (r) => (
              <div>
                <strong>{r.product_code || "No SKU code"}</strong>
                <p className="text-xs text-text-secondary">{r.variant_name}</p>
              </div>
            ),
          },
          { key: "product_name", label: "Product" },
          {
            key: "configuration_status",
            label: "Label status",
            render: (r) => (
              <FactoryStatusBadge status={r.configuration_status} />
            ),
          },
          {
            key: "template",
            label: "Assigned template",
            render: (r) =>
              r.template_name
                ? `${r.template_name} · v${r.template_version}`
                : "Not assigned",
          },
          {
            key: "version",
            label: "Approved version",
            render: (r) => r.config_version || "—",
          },
          {
            key: "actions",
            label: "Actions",
            render: (r) => (
              <button
                className="btn-secondary"
                onClick={() =>
                  openLabelManagement({ section: "products", sku: r.id })
                }
              >
                <Pencil size={14} />
                {canEdit ? "Edit Label" : "View Label"}
              </button>
            ),
          },
        ]
      : location.section === "templates"
        ? [
            { key: "name", label: "Template" },
            {
              key: "version",
              label: "Approved version",
              render: (r) => r.version || "—",
            },
            {
              key: "configuration_status",
              label: "Status",
              render: (r) => (
                <FactoryStatusBadge status={r.configuration_status} />
              ),
            },
            { key: "assignments", label: "SKU assignments" },
            {
              key: "actions",
              label: "Actions",
              render: (r) => (
                <button
                  className="btn-secondary"
                  onClick={() =>
                    openLabelManagement({
                      section: "templates",
                      template: r.template_key,
                    })
                  }
                >
                  <Pencil size={14} />
                  {canEdit ? "Edit Template" : "View Template"}
                </button>
              ),
            },
          ]
        : [
            { key: "name", label: "Print bridge" },
            { key: "printer_name", label: "Configured Windows printer" },
            { key: "transport", label: "Transport" },
            {
              key: "status",
              label: "Status",
              render: (r) => (
                <FactoryStatusBadge
                  status={
                    !r.enabled
                      ? "Disabled"
                      : Date.now() - Date.parse(r.last_seen) > 90000
                        ? "Offline"
                        : r.status
                  }
                />
              ),
            },
            {
              key: "last_seen",
              label: "Last connected",
              render: (r) => new Date(r.last_seen).toLocaleString(),
            },
            {
              key: "actions",
              label: "Actions",
              render: (r) => (
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setPrinter(r);
                    setReason("");
                  }}
                >
                  <Printer size={14} />
                  Configuration
                </button>
              ),
            },
          ];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Label Management"
        description="Manage Packaging SKU labels, reusable templates and Windows print bridges."
        actions={
          location.section === "templates" && canEdit ? (
            <button
              className="btn-primary"
              onClick={() =>
                openLabelManagement({
                  section: "templates",
                  template: `layout-${crypto.randomUUID()}`,
                })
              }
            >
              <Plus size={15} />
              New Template
            </button>
          ) : null
        }
      />
      <FactorySegmentedControl
        label="Label Management sections"
        value={location.section}
        onChange={(section) => openLabelManagement({ section })}
        options={[
          { value: "products", label: "Product Labels" },
          { value: "templates", label: "Templates" },
          { value: "printers", label: "Printers" },
        ]}
      />
      <FactoryFilterBar>
        <Field label="Search">
          <input
            aria-label="Search labels"
            className={inputClass()}
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={
              location.section === "products"
                ? "Product or Packaging SKU"
                : location.section === "templates"
                  ? "Template name"
                  : "Bridge or printer name"
            }
          />
        </Field>
      </FactoryFilterBar>
      {error && (
        <p role="alert">
          {error}{" "}
          <button className="btn-secondary" onClick={load}>
            Retry
          </button>
        </p>
      )}
      {loading && (
        <p role="status" className="text-sm text-text-secondary">
          Loading{" "}
          {location.section === "products"
            ? "Product Labels"
            : location.section === "templates"
              ? "Templates"
              : "Printers"}
          …
        </p>
      )}
      <FactoryDataSurface>
        <FactoryTable
          columns={columns}
          rows={data.rows}
          emptyTitle={
            loading
              ? "Loading…"
              : location.section === "printers"
                ? "No registered print bridges"
                : "No matching labels"
          }
          emptyDescription={
            location.section === "printers"
              ? "Install and sign in to the Windows Print Bridge to register an existing Windows printer."
              : "Change the search to see other records."
          }
        />
        <FactoryPagination
          page={page}
          pageSize={20}
          total={data.total}
          loading={loading}
          onPageChange={setPage}
          onPageSizeChange={() => {}}
        />
      </FactoryDataSurface>
      {location.section === "printers" && (
        <p className="text-sm text-text-secondary">
          <a
            className="underline"
            href="/downloads/feedx-print-bridge-staging.zip"
            download
          >
            Download Windows Print Bridge and setup guide
          </a>
          . Printer queue selection, transport and calibration are configured on
          its Windows computer. Print Labels remains available from completed
          Job Orders.
        </p>
      )}
      {printer && (
        <Modal
          title="Printer Configuration"
          description={printer.name}
          size="md"
          onClose={saving ? undefined : () => setPrinter(null)}
          footer={
            <>
              <button
                className="btn-secondary"
                disabled={saving}
                onClick={() => setPrinter(null)}
              >
                Close
              </button>
              {canEdit && (
                <button
                  className="btn-primary"
                  disabled={saving || reason.trim().length < 3}
                  onClick={togglePrinter}
                >
                  {printer.enabled ? "Disable Bridge" : "Enable Bridge"}
                </button>
              )}
            </>
          }
        >
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <dt>Windows printer</dt>
              <dd>{printer.printer_name}</dd>
              <dt>Transport</dt>
              <dd>{printer.transport}</dd>
              <dt>Availability</dt>
              <dd>{printer.enabled ? "Enabled" : "Disabled"}</dd>
            </dl>
            <h3 className="font-semibold">Discovered Windows printers</h3>
            {(printer.printers || []).map((p) => (
              <p className="text-sm" key={p.Name}>
                {p.Name} · {p.WorkOffline ? "Offline" : "Available to Windows"}
              </p>
            ))}
            <p className="text-sm text-text-secondary">
              Change the queue, driver, TSPL settings or media calibration
              through the existing bridge on Windows. Disabling pauses new
              claims; an active Printing job must be resolved first.
            </p>
            {canEdit && (
              <Field label="Configuration change reason">
                <input
                  aria-label="Configuration change reason"
                  className={inputClass()}
                  disabled={saving}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={1000}
                />
              </Field>
            )}
            {error && <p role="alert">{error}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
