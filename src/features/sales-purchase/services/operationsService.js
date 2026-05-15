import {
  importRuns,
  monthlyLocks,
  outletTaxConfigs,
  outlets,
  purchaseCategories,
  purchaseRecords,
  salesChannels,
  salesRecords,
  specialMonths,
  suppliers,
  taxConfigAuditTrail,
} from "../data/mockData";

const clone = (value) => JSON.parse(JSON.stringify(value));

export const operationsService = {
  getBootstrapData() {
    return clone({
      outlets,
      outletTaxConfigs,
      salesChannels,
      purchaseCategories,
      suppliers,
      salesRecords,
      specialMonths,
      purchaseRecords,
      monthlyLocks,
      importRuns,
      taxConfigAuditTrail,
    });
  },

  upsertSalesData(state, { outletId, month, year, salesRows }) {
    const updatedAt = new Date().toISOString();
    return {
      ...state,
      salesRecords: [
        ...state.salesRecords.filter(
          (record) => !(record.outlet_id === outletId && record.month === month && record.year === year),
        ),
        ...salesRows.map((row) => ({
          ...(row.id ? { id: row.id } : {}),
          outlet_id: outletId,
          month,
          year,
          channel_id: row.channel_id,
          amount: Number(row.amount) || 0,
          remark: row.remark ?? "",
          created_at: row.created_at ?? updatedAt,
          updated_at: updatedAt,
        })),
      ],
    };
  },

  upsertPurchaseData(state, { outletId, month, year, purchaseRows }) {
    const updatedAt = new Date().toISOString();
    return {
      ...state,
      purchaseRecords: [
        ...state.purchaseRecords.filter(
          (record) => !(record.outlet_id === outletId && record.month === month && record.year === year),
        ),
        ...purchaseRows
          .filter((row) => row.supplier_id)
          .map((row) => ({
            ...(row.id ? { id: row.id } : {}),
            outlet_id: outletId,
            month,
            year,
            supplier_id: row.supplier_id,
            category_id: row.category_id,
            remark: row.remark ?? "",
            amount: Number(row.amount) || 0,
            created_at: row.created_at ?? updatedAt,
            updated_at: updatedAt,
          })),
      ],
    };
  },

  importPurchaseData(state, { outletId, month, year, purchaseRows, mode = "update_matching" }) {
    const updatedAt = new Date().toISOString();
    const existing = state.purchaseRecords.filter(
      (record) => record.outlet_id === outletId && record.month === month && record.year === year,
    );
    const otherRecords = state.purchaseRecords.filter(
      (record) => !(record.outlet_id === outletId && record.month === month && record.year === year),
    );
    const uniqueRows = [...purchaseRows.filter((row) => row.supplier_id).reduce((map, row) => map.set(row.supplier_id, row), new Map()).values()];

    if (mode === "replace") {
      const created = uniqueRows.map((row) => ({
        outlet_id: outletId,
        month,
        year,
        supplier_id: row.supplier_id,
        category_id: row.category_id,
        remark: row.remark ?? "",
        amount: Number(row.amount) || 0,
        created_at: updatedAt,
        updated_at: updatedAt,
      }));
      return {
        state: { ...state, purchaseRecords: [...otherRecords, ...created] },
        stats: { created_rows: created.length, updated_rows: 0, replaced_rows: existing.length, skipped_rows: 0 },
      };
    }

    if (mode === "merge") {
      const existingSupplierIds = new Set(existing.map((record) => record.supplier_id));
      const created = uniqueRows
        .filter((row) => !existingSupplierIds.has(row.supplier_id))
        .map((row) => ({
          outlet_id: outletId,
          month,
          year,
          supplier_id: row.supplier_id,
          category_id: row.category_id,
          remark: row.remark ?? "",
          amount: Number(row.amount) || 0,
          created_at: updatedAt,
          updated_at: updatedAt,
        }));
      return {
        state: { ...state, purchaseRecords: [...state.purchaseRecords, ...created] },
        stats: { created_rows: created.length, updated_rows: 0, replaced_rows: 0, skipped_rows: uniqueRows.length - created.length },
      };
    }

    const rowsBySupplier = new Map(uniqueRows.map((row) => [row.supplier_id, row]));
    let updatedRows = 0;
    const updatedExisting = existing.map((record) => {
      const incoming = rowsBySupplier.get(record.supplier_id);
      if (!incoming) return record;
      updatedRows += 1;
      rowsBySupplier.delete(record.supplier_id);
      return {
        ...record,
        category_id: incoming.category_id,
        remark: incoming.remark ?? "",
        amount: Number(incoming.amount) || 0,
        updated_at: updatedAt,
      };
    });
    const created = [...rowsBySupplier.values()].map((row) => ({
      outlet_id: outletId,
      month,
      year,
      supplier_id: row.supplier_id,
      category_id: row.category_id,
      remark: row.remark ?? "",
      amount: Number(row.amount) || 0,
      created_at: updatedAt,
      updated_at: updatedAt,
    }));
    return {
      state: { ...state, purchaseRecords: [...otherRecords, ...updatedExisting, ...created] },
      stats: { created_rows: created.length, updated_rows: updatedRows, replaced_rows: 0, skipped_rows: 0 },
    };
  },

  addSupplier(state, name, defaultCategoryId = "cat-others") {
    const supplier = {
      id: `sup-${crypto.randomUUID()}`,
      name,
      default_category_id: defaultCategoryId,
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return { state: { ...state, suppliers: [...state.suppliers, supplier] }, supplier };
  },

  updateSupplier(state, supplierId, patch) {
    const updatedAt = new Date().toISOString();
    return {
      ...state,
      suppliers: state.suppliers.map((supplier) =>
        supplier.id === supplierId ? { ...supplier, ...patch, updated_at: updatedAt } : supplier,
      ),
    };
  },

  deactivateSupplier(state, supplierId) {
    return this.updateSupplier(state, supplierId, { status: "inactive" });
  },

  addOutlet(state, name, code = "", location = "Unassigned") {
    const outlet = {
      id: `outlet-${crypto.randomUUID()}`,
      name,
      code: code || name.slice(0, 4).toUpperCase(),
      location,
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return { state: { ...state, outlets: [...state.outlets, outlet] }, outlet };
  },

  updateOutlet(state, outletId, patch) {
    const updatedAt = new Date().toISOString();
    return {
      ...state,
      outlets: state.outlets.map((outlet) =>
        outlet.id === outletId ? { ...outlet, ...patch, updated_at: updatedAt } : outlet,
      ),
    };
  },

  addOutletTaxConfig(state, values) {
    const timestamp = new Date().toISOString();
    const taxType = values.tax_type || "SST";
    const config = {
      id: `tax-${values.outlet_id}-${String(taxType).toLowerCase()}-${values.effective_from}-${crypto.randomUUID()}`,
      outlet_id: values.outlet_id,
      tax_type: taxType,
      enabled: Boolean(values.enabled),
      rate: Number(values.rate) || 0,
      effective_from: values.effective_from,
      effective_until: values.effective_until || null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    const previousMonthDate = new Date(`${values.effective_from}-01T00:00:00.000Z`);
    previousMonthDate.setUTCMonth(previousMonthDate.getUTCMonth() - 1);
    const previousMonth = `${previousMonthDate.getUTCFullYear()}-${String(previousMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;
    const scoped = (state.outletTaxConfigs || []).filter((item) => item.outlet_id === values.outlet_id && item.tax_type === taxType);
    const latest = [...scoped].sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    const nextConfigs = (state.outletTaxConfigs || []).map((item) =>
      latest && item.id === latest.id && !item.effective_until
        ? { ...item, effective_until: previousMonth, updated_at: timestamp }
        : item,
    );
    const audit = {
      id: `tax-audit-${crypto.randomUUID()}`,
      action: "create_revision",
      tax_config_id: config.id,
      user: values.user || "Marcus Lee",
      before: latest || null,
      after: config,
      timestamp,
    };
    return { state: { ...state, outletTaxConfigs: [...nextConfigs, config], taxConfigAuditTrail: [audit, ...(state.taxConfigAuditTrail || [])] }, config };
  },

  updateOutletTaxConfig(state, configId, patch, { user = "Marcus Lee", action = "edit_future" } = {}) {
    const timestamp = new Date().toISOString();
    const before = (state.outletTaxConfigs || []).find((item) => item.id === configId);
    const after = before ? { ...before, ...patch, enabled: Boolean(patch.enabled), rate: Number(patch.rate) || 0, effective_until: patch.effective_until || null, updated_at: timestamp } : null;
    const audit = {
      id: `tax-audit-${crypto.randomUUID()}`,
      action,
      tax_config_id: configId,
      user,
      before,
      after,
      timestamp,
    };
    return {
      ...state,
      outletTaxConfigs: (state.outletTaxConfigs || []).map((item) => (item.id === configId ? after : item)),
      taxConfigAuditTrail: [audit, ...(state.taxConfigAuditTrail || [])],
    };
  },

  endOutletTaxConfig(state, configId, effectiveUntil, user = "Marcus Lee") {
    const timestamp = new Date().toISOString();
    const before = (state.outletTaxConfigs || []).find((item) => item.id === configId);
    const after = before ? { ...before, effective_until: effectiveUntil || null, updated_at: timestamp } : null;
    const audit = {
      id: `tax-audit-${crypto.randomUUID()}`,
      action: "end_config",
      tax_config_id: configId,
      user,
      before,
      after,
      timestamp,
    };
    return {
      ...state,
      outletTaxConfigs: (state.outletTaxConfigs || []).map((item) => (item.id === configId ? after : item)),
      taxConfigAuditTrail: [audit, ...(state.taxConfigAuditTrail || [])],
    };
  },

  deactivateOutlet(state, outletId) {
    return this.updateOutlet(state, outletId, { status: "inactive" });
  },

  addSalesChannel(state, name, type = "channel") {
    const channel = {
      id: `channel-${crypto.randomUUID()}`,
      name,
      type,
      sort_order: Math.max(0, ...state.salesChannels.map((channel) => Number(channel.sort_order) || 0)) + 1,
      status: "active",
    };
    return { state: { ...state, salesChannels: [...state.salesChannels, channel] }, channel };
  },

  updateSalesChannel(state, channelId, patch) {
    return {
      ...state,
      salesChannels: state.salesChannels.map((channel) =>
        channel.id === channelId ? { ...channel, ...patch } : channel,
      ),
    };
  },

  addPurchaseCategory(state, name) {
    const category = {
      id: `cat-${crypto.randomUUID()}`,
      name,
      sort_order: state.purchaseCategories.length + 1,
      status: "active",
    };
    return { state: { ...state, purchaseCategories: [...state.purchaseCategories, category] }, category };
  },

  updatePurchaseCategory(state, categoryId, patch) {
    return {
      ...state,
      purchaseCategories: state.purchaseCategories.map((category) =>
        category.id === categoryId ? { ...category, ...patch } : category,
      ),
    };
  },

  setMonthLock(state, { outletId, month, year, isLocked, user = "Marcus Lee" }) {
    const timestamp = new Date().toISOString();
    const existing = state.monthlyLocks.find(
      (lock) => lock.outlet_id === outletId && lock.month === month && lock.year === year,
    );
    const nextLock = {
      id: existing?.id ?? `lock-${outletId}-${year}-${month}`,
      outlet_id: outletId,
      month,
      year,
      is_locked: isLocked,
      locked_by: isLocked ? user : existing?.locked_by ?? "",
      locked_at: isLocked ? timestamp : existing?.locked_at ?? "",
      unlocked_by: isLocked ? existing?.unlocked_by ?? "" : user,
      unlocked_at: isLocked ? existing?.unlocked_at ?? "" : timestamp,
    };

    return {
      ...state,
      monthlyLocks: [
        ...state.monthlyLocks.filter(
          (lock) => !(lock.outlet_id === outletId && lock.month === month && lock.year === year),
        ),
        nextLock,
      ],
    };
  },

  addImportRun(state, importTypeOrPayload, fileName) {
    const payload = typeof importTypeOrPayload === "object" ? importTypeOrPayload : { import_type: importTypeOrPayload, file_name: fileName };
    const run = {
      id: `import-${crypto.randomUUID()}`,
      file_name: payload.file_name,
      import_type: payload.import_type,
      status: payload.status || "success",
      imported_by: payload.imported_by || "Marcus Lee",
      created_at: new Date().toISOString(),
      rows_count: payload.rows_count ?? payload.imported_rows ?? 0,
      imported_rows: payload.imported_rows ?? payload.rows_count ?? 0,
      failed_rows: payload.failed_rows ?? 0,
      warnings_count: payload.warnings_count ?? 0,
      import_mode: payload.import_mode ?? "manual",
      conflict_mode: payload.conflict_mode ?? "replace",
      affected_outlet_id: payload.affected_outlet_id,
      affected_month: payload.affected_month,
      affected_year: payload.affected_year,
      rollback_until: payload.rollback_until,
      rollback_data: payload.rollback_data,
      created_rows: payload.created_rows ?? 0,
      updated_rows: payload.updated_rows ?? 0,
      replaced_rows: payload.replaced_rows ?? 0,
      skipped_rows: payload.skipped_rows ?? 0,
    };
    return { state: { ...state, importRuns: [run, ...state.importRuns] }, run };
  },

  rollbackImportRun(state, importRunId, user = "Marcus Lee") {
    const run = state.importRuns.find((item) => item.id === importRunId);
    if (!run?.rollback_data || run.status === "rolled_back") return state;
    return {
      ...state,
      salesRecords: run.rollback_data.salesRecords ?? state.salesRecords,
      purchaseRecords: run.rollback_data.purchaseRecords ?? state.purchaseRecords,
      importRuns: state.importRuns.map((item) =>
        item.id === importRunId
          ? { ...item, status: "rolled_back", rolled_back_by: user, rolled_back_at: new Date().toISOString() }
          : item,
      ),
    };
  },
};
