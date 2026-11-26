import { useEffect, useRef, useState } from "react";
import { Eye, Pencil, Plus, Printer } from "lucide-react";
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
import PrinterSetupWizard, { bridgeRelease, livePrinterReport, printerInstallers, printerSetupStatus } from "../labels/PrinterSetupWizard.jsx";
import { formatFactoryAuditDateTime } from "../utils/factoryDates.js";
import FactoryLabelEditorPage from "../labels/FactoryLabelEditorPage.jsx";
import ActiveTemplatePreview from "../labels/ActiveTemplatePreview.jsx";
import useLabelManagementQuery from "../labels/useLabelManagementQuery.js";
import {
  openLabelManagement,
  readLabelManagementLocation,
} from "../labels/labelManagementNavigation.js";

function BridgeLastSeen({ value, now }) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Never reported";
  const seconds = Math.max(0, (now - timestamp) / 1000);
  const [amount, unit] = seconds < 60 ? [0, "second"]
    : seconds < 3600 ? [seconds / 60, "minute"]
    : seconds < 86400 ? [seconds / 3600, "hour"]
    : [seconds / 86400, "day"];
  const relative = amount === 0 ? "Just now" : new Intl.RelativeTimeFormat("en").format(-Math.floor(amount), unit);
  return <time dateTime={value} className="block">
    <span className="block">{relative}</span>
    <span className="block text-xs text-text-secondary">{formatFactoryAuditDateTime(value)} MYT</span>
  </time>;
}

export default function FactoryLabelManagementPage({ onConfirm, onNotify }) {
  const { can } = useFactoryPermissions(),
    canEdit = can("factory_finished_goods.edit");
  const [location, setLocation] = useState(readLabelManagementLocation),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [actionError, setActionError] = useState(""),
    [previewTemplate, setPreviewTemplate] = useState(null),
    [printer, setPrinter] = useState(null),
    [wizard, setWizard] = useState(null),
    [reason, setReason] = useState(""),
    [deviceName, setDeviceName] = useState(""),
    [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const { data, loading, hasData, error, refresh, now } = useLabelManagementQuery({
    section: location.section,
    page,
    search,
    enabled: factoryLabelsEnabled && !location.sku && !location.template,
    mutationLock: lock,
  });
  const selectedPrinter = data.rows.find((row) => row.id === printer?.id) || printer;
  const selectedStatus = selectedPrinter && printerSetupStatus(selectedPrinter, now);
  const release = bridgeRelease(selectedPrinter);
  const selectedProbe = selectedPrinter && livePrinterReport(selectedPrinter, selectedStatus.bridge === "Online", now);
  const canSetup = can("factory_production.complete");
  useEffect(() => {
    const change = () => {
      setLocation(readLabelManagementLocation());
      setPage(1);
      setSearch("");
      setPreviewTemplate(null);
    };
    window.addEventListener("popstate", change);
    return () => window.removeEventListener("popstate", change);
  }, []);
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
        key={location.sku ? [location.sku, location.label].join(":") : location.template}
        kind={location.sku ? "product" : "template"}
        entityKey={location.sku && location.label ? `${location.sku}:${location.label}` : location.sku || location.template}
        labelKey={location.label || "product"}
        canEdit={canEdit}
        onConfirm={onConfirm}
        onNotify={onNotify}
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
    setActionError("");
    try {
      await factoryLabelService.setDeviceEnabled(
        printer.id,
        !selectedPrinter.enabled,
        reason,
      );
      setPrinter(null);
      setReason("");
      await refresh({ replace: true });
    } catch (e) {
      setActionError(e.message);
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
            key: "labels",
            label: "Label configurations",
            render: (sku) => (
              <div className="space-y-2">
                {(sku.labels || []).map((label) => (
                  <div key={label.label_key} className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{label.name}</strong>
                        <FactoryStatusBadge status={label.status} />
                      </div>
                      {label.active_version && (
                        <p className="text-xs text-text-secondary">Active v{label.active_version} · {label.template_name} · template v{label.template_version}</p>
                      )}
                      {label.draft_revision && (
                        <p className="text-xs text-text-secondary">
                          Draft{label.draft_name && label.draft_name !== label.name ? ` · ${label.draft_name}` : ""} · {label.draft_template_name ? `${label.draft_template_name} · template v${label.draft_template_version}` : "No template assigned"}
                        </p>
                      )}
                    </div>
                    <button type="button" className="btn-secondary"
                      aria-label={`${canEdit ? "Edit" : "View"} ${label.name} for ${sku.product_code || sku.product_name}`}
                      onClick={() => openLabelManagement({
                        section: "products",
                        sku: sku.id,
                        ...(label.label_key !== "product" ? { label: label.label_key } : {}),
                      })}>
                      <Pencil size={14} aria-hidden="true" /> {canEdit ? "Edit Label" : "View Label"}
                    </button>
                  </div>
                ))}
              </div>
            ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (sku) => canEdit && (
              <button type="button" className="btn-secondary"
                aria-label={`Add label for ${sku.product_code || sku.product_name}`}
                onClick={() => openLabelManagement({ section: "products", sku: sku.id, label: crypto.randomUUID() })}>
                <Plus size={14} aria-hidden="true" /> Add Label
              </button>
            ),
          },
        ]
      : location.section === "templates"
        ? [
            { key: "name", label: "Template" },
            {
              key: "version",
              label: "Active Version",
              render: (r) => r.version ? `v${r.version}` : "—",
            },
            {
              key: "configuration_status",
              label: "Status",
              render: (r) => (
                <>
                  <FactoryStatusBadge status={r.version ? "Active" : "Draft"} />
                  {r.version && r.configuration_status === "Draft" && (
                    <p className="text-xs text-text-secondary">Saved draft</p>
                  )}
                </>
              ),
            },
            { key: "assignments", label: "SKU assignments" },
            {
              key: "actions",
              label: "Actions",
              render: (r) => (
                <div className="flex flex-wrap items-center gap-2">
                  {r.version && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`View active template: ${r.name}`}
                      title="View active template"
                      onClick={() => setPreviewTemplate(r)}
                    >
                      <Eye size={16} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => openLabelManagement({
                      section: "templates",
                      template: r.template_key,
                    })}
                  >
                    {canEdit && <Pencil size={14} aria-hidden="true" />}
                    {canEdit ? "Edit Template" : r.version ? "Template Details" : "View Draft"}
                  </button>
                </div>
              ),
            },
          ]
        : [
            {
              key: "printer",
              label: "Printer / bridge",
              render: (r) => <div><strong>{r.printer_name}</strong><p className="text-xs text-text-secondary">{r.name}</p></div>,
            },
            { key: "bridge", label: "Bridge", render: (r) => <FactoryStatusBadge status={printerSetupStatus(r, now).bridge} /> },
            { key: "connection", label: "Printer connection", render: (r) => <FactoryStatusBadge status={printerSetupStatus(r, now).connection} /> },
            { key: "calibration", label: "Calibration", render: (r) => <FactoryStatusBadge status={printerSetupStatus(r, now).calibration} /> },
            { key: "unresolved", label: "Unresolved jobs", render: (r) => r.unresolved_jobs ?? "—" },
            {
              key: "last_seen",
              label: "Last seen",
              render: (r) => <BridgeLastSeen now={now} value={r.last_seen} />,
            },
            {
              key: "actions",
              label: "Actions",
              render: (r) => (
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setPrinter(r);
                    setDeviceName(r.name);
                    setReason("");
                    setActionError("");
                  }}
                >
                  <Printer size={14} />
                  Manage
                </button>
              ),
            },
          ];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Label Management"
        description="Manage Packaging SKU labels, reusable templates and print bridges."
        actions={
          location.section === "printers" && canSetup ? (
            <button className="btn-primary" onClick={() => setWizard({})}><Printer size={15} /> Set Up Printer</button>
          ) : location.section === "templates" && canEdit ? (
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
      <FactoryDataSurface>
        <FactoryTable
          columns={columns}
          rows={data.rows}
          rowKey={(row) => row.template_key ?? row.id}
          loading={loading}
          emptyTitle={
            error && !hasData
              ? "Could not load records"
              : location.section === "printers"
                ? "No registered print bridges"
                : "No matching labels"
          }
          emptyDescription={
            error && !hasData ? "" : location.section === "printers"
              ? "Set up the Windows or macOS Print Bridge to register a printer."
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
      {error && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
          <p role="status">{hasData ? "Could not refresh printer status. Showing last reported data." : error}</p>
          <button type="button" className="btn-secondary" onClick={() => refresh()}>Retry</button>
        </div>
      )}
      {previewTemplate && (
        <ActiveTemplatePreview
          key={previewTemplate.template_key}
          templateKey={previewTemplate.template_key}
          name={previewTemplate.name}
          onClose={() => setPreviewTemplate(null)}
        />
      )}
      {wizard && (
        <PrinterSetupWizard
          onClose={() => setWizard(null)}
          onRefresh={refresh}
          refreshError={error}
          devices={data.rows}
          selected={wizard.printer}
          now={now}
        />
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
            </>
          }
        >
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt>Printer</dt><dd>{selectedPrinter.printer_name}</dd>
              <dt>Bridge</dt><dd><FactoryStatusBadge status={selectedStatus.bridge} /></dd>
              <dt>Bridge version</dt><dd>{release.version ? `v${release.version}` : "Not reported"}{release.update && release.platform && <> · <a className="underline" href={printerInstallers[release.platform]} download>Update available</a></>}</dd>
              <dt>Printer connection</dt><dd><FactoryStatusBadge status={selectedStatus.connection} /></dd>
              {selectedProbe?.ConnectionCheckedAt && <>
                <dt>Printer checked</dt><dd><BridgeLastSeen now={now} value={selectedProbe.ConnectionCheckedAt} /></dd>
              </>}
              <dt>Readiness</dt><dd><FactoryStatusBadge status={selectedStatus.readiness} /></dd>
              <dt>Last seen</dt><dd><BridgeLastSeen now={now} value={selectedPrinter.last_seen} /></dd>
              <dt>Last reported calibration</dt><dd><FactoryStatusBadge status={selectedStatus.calibration} /></dd>
              <dt>Unresolved jobs</dt><dd>{selectedPrinter.unresolved_jobs ?? "—"}</dd>
            </dl>
            {selectedPrinter.unresolved_jobs > 0 && (
              <p className="text-sm text-text-secondary">Review held output in the affected Job Order’s Print History.</p>
            )}
            {selectedStatus.bridge === "Offline" && (
              <p className="text-sm text-text-secondary">On the registered computer, open FeedX Print Bridge and choose Reconnect. If sign-in has expired, choose Reauthorize and use the original operator account.</p>
            )}
            {selectedProbe?.ConnectionDetail && (
              <p className="text-sm text-text-secondary">{selectedProbe.ConnectionDetail}</p>
            )}
            {selectedStatus.bridge === "Online" && selectedStatus.connection !== "Available" && !selectedProbe?.ConnectionDetail && (
              <p className="text-sm text-text-secondary">The Bridge is reporting. Check printer power and run Connection Check on the registered computer. Bluetooth pairing alone does not confirm a connection.</p>
            )}
            {canSetup && (
              <div className="flex flex-wrap gap-2">
                {selectedPrinter.enabled && <a className="btn-secondary" href="feedx-printer-staging://setup">{selectedStatus.bridge === "Offline" ? "Open Setup to Reconnect" : "Open Bridge Setup"}</a>}
                <button className="btn-secondary" onClick={() => {
                  setWizard({ printer: selectedPrinter }); setPrinter(null);
                }}>Troubleshoot</button>
              </div>
            )}
            {canEdit && <form className="flex flex-wrap items-end gap-2" onSubmit={async (event) => {
              event.preventDefault();
              if (lock.current || !deviceName.trim() || deviceName.trim() === selectedPrinter.name) return;
              lock.current = true;
              setSaving(true);
              setActionError("");
              try {
                await factoryLabelService.renameDevice(selectedPrinter.id, deviceName.trim());
                setPrinter((current) => current ? { ...current, name: deviceName.trim() } : current);
                await refresh({ replace: true });
              } catch (failure) {
                setActionError(failure.message || "The device name could not be saved.");
              } finally {
                lock.current = false;
                setSaving(false);
              }
            }}>
              <Field label="Device name">
                <input aria-label="Device name" className={inputClass()} value={deviceName} maxLength={100}
                  disabled={saving} onChange={(event) => setDeviceName(event.target.value)} />
              </Field>
              <button className="btn-secondary" disabled={saving || !deviceName.trim() || deviceName.trim() === selectedPrinter.name}>Save name</button>
            </form>}
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Last reported printers ({selectedPrinter.printers?.length || 0})</summary>
              <ul className="mt-2 space-y-1">
                {(selectedPrinter.printers || []).map((p) => (
                  <li key={p.Name}>{p.Name}{p.Connection ? ` · ${p.Connection}` : ""}</li>
                ))}
              </ul>
            </details>
            {canEdit && (
              <details className="space-y-3 text-sm">
                <summary className="cursor-pointer font-medium">Advanced · Bridge availability</summary>
                <p className="text-text-secondary">Disabling pauses new claims. Resolve active printing before disabling.</p>
                <Field label="Reason for availability change">
                  <input
                    aria-label="Reason for availability change"
                    className={inputClass()}
                    disabled={saving}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={1000}
                  />
                </Field>
                <button className="btn-secondary" disabled={saving || reason.trim().length < 3} onClick={togglePrinter}>
                  {selectedPrinter.enabled ? "Disable Bridge" : "Enable Bridge"}
                </button>
              </details>
            )}
            {actionError && <p role="alert">{actionError}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
