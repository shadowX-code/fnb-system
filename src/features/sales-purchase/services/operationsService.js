import {
  importRuns,
  monthlyLocks,
  outlets,
  purchaseCategories,
  purchaseRecords,
  salesChannels,
  salesRecords,
  suppliers,
} from "../data/mockData";

const clone = (value) => JSON.parse(JSON.stringify(value));

export const operationsService = {
  getBootstrapData() {
    return clone({
      outlets,
      salesChannels,
      purchaseCategories,
      suppliers,
      salesRecords,
      purchaseRecords,
      monthlyLocks,
      importRuns,
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
          id: row.id ?? `sales-${outletId}-${year}-${month}-${row.channel_id}`,
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
            id: row.id ?? `purchase-${outletId}-${year}-${month}-${row.supplier_id}-${crypto.randomUUID()}`,
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

  addImportRun(state, importType, fileName) {
    const run = {
      id: `import-${crypto.randomUUID()}`,
      file_name: fileName,
      import_type: importType,
      status: "success",
      imported_by: "Marcus Lee",
      created_at: new Date().toISOString(),
      imported_rows: 42,
      failed_rows: 2,
    };
    return { state: { ...state, importRuns: [run, ...state.importRuns] }, run };
  },
};
