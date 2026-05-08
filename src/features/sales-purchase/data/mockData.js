export const months = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
];

const now = "2026-05-08T00:00:00.000Z";

export const outlets = [
  {
    id: "outlet-001",
    name: "Hola Ipoh Bangsar",
    code: "HIPB",
    location: "Bangsar, Kuala Lumpur",
    status: "active",
    created_at: now,
    updated_at: now,
  },
  {
    id: "outlet-002",
    name: "Hola TTDI",
    code: "HTTD",
    location: "Taman Tun Dr Ismail",
    status: "active",
    created_at: now,
    updated_at: now,
  },
  {
    id: "outlet-003",
    name: "Hola Mont Kiara",
    code: "HMK",
    location: "Mont Kiara",
    status: "active",
    created_at: now,
    updated_at: now,
  },
  {
    id: "outlet-004",
    name: "Hola Subang",
    code: "HSBG",
    location: "Subang Jaya",
    status: "active",
    created_at: now,
    updated_at: now,
  },
];

export const salesChannels = [
  { id: "channel-net-sales", name: "Net Sales", type: "total", sort_order: 1, status: "active" },
  { id: "channel-dine-in", name: "Dine In", type: "channel", sort_order: 2, status: "active" },
  { id: "channel-takeaway", name: "Takeaway", type: "channel", sort_order: 3, status: "active" },
  { id: "channel-grabfood", name: "GrabFood", type: "channel", sort_order: 4, status: "active" },
  { id: "channel-foodpanda", name: "FoodPanda", type: "channel", sort_order: 5, status: "active" },
  { id: "channel-shopeefood", name: "ShopeeFood", type: "channel", sort_order: 6, status: "active" },
  { id: "channel-sst", name: "SST (-)", type: "adjustment", sort_order: 7, status: "active" },
];

export const purchaseCategories = [
  { id: "cat-chicken", name: "Chicken", sort_order: 1, status: "active" },
  { id: "cat-frozen", name: "Frozen", sort_order: 2, status: "active" },
  { id: "cat-egg", name: "Egg", sort_order: 3, status: "active" },
  { id: "cat-rice-sauce", name: "Rice / Sauce", sort_order: 4, status: "active" },
  { id: "cat-beverage", name: "Beverage", sort_order: 5, status: "active" },
  { id: "cat-vegetable", name: "Vegetable", sort_order: 6, status: "active" },
  { id: "cat-packaging", name: "Packaging", sort_order: 7, status: "active" },
  { id: "cat-others", name: "Others", sort_order: 8, status: "active" },
];

export const suppliers = [
  { id: "sup-001", name: "Pasar Mini TLL", default_category_id: "cat-chicken", status: "active", created_at: now, updated_at: now },
  { id: "sup-002", name: "IDAMAN'S Food Industry", default_category_id: "cat-frozen", status: "active", created_at: now, updated_at: now },
  { id: "sup-003", name: "Chang Jiang", default_category_id: "cat-beverage", status: "active", created_at: now, updated_at: now },
  { id: "sup-004", name: "Eng Kee Son", default_category_id: "cat-packaging", status: "active", created_at: now, updated_at: now },
  { id: "sup-005", name: "Menglembu Mee Factory", default_category_id: "cat-rice-sauce", status: "active", created_at: now, updated_at: now },
  { id: "sup-006", name: "Yee Wah Frozen", default_category_id: "cat-frozen", status: "active", created_at: now, updated_at: now },
  { id: "sup-007", name: "Fresh Egg Supply Co.", default_category_id: "cat-egg", status: "active", created_at: now, updated_at: now },
  { id: "sup-008", name: "Daily Greens Market", default_category_id: "cat-vegetable", status: "active", created_at: now, updated_at: now },
];

const salesSeed = {
  1: [73480, 56580, 1306, 6088, 3030, 611, -4135],
  2: [77105, 57862, 1402, 6720, 3380, 657, -2916],
  3: [82610, 60730, 1510, 7025, 3650, 700, -1005],
  4: [80304, 59410, 1450, 6898, 3520, 690, -1664],
  5: [82361.8, 65497.7, 1306.9, 6088.9, 3030.4, 611.6, -4072.25],
};

export const salesRecords = Object.entries(salesSeed).flatMap(([month, amounts]) =>
  amounts.map((amount, index) => ({
    id: `sales-outlet-001-2026-${month}-${salesChannels[index].id}`,
    outlet_id: "outlet-001",
    month: Number(month),
    year: 2026,
    channel_id: salesChannels[index].id,
    amount,
    remark: salesChannels[index].id === "channel-sst" ? "SST Adjustment" : "",
    created_at: now,
    updated_at: now,
  })),
);

const purchaseSeed = {
  1: [6080.5, 4420.4, 420.0, 910.5, 5136.0, 1504.0, 1726.5, 3310.0],
  2: [6680.0, 4560.5, 433.6, 972.2, 5036.0, 1566.4, 1842.3, 3460.0],
  3: [6760.0, 5020.3, 452.5, 1005.0, 5210.0, 1660.4, 1900.0, 3620.0],
  4: [6810.0, 4582.1, 433.6, 972.2, 5636.0, 1906.4, 1960.0, 3510.0],
  5: [8055.0, 5036.0, 433.6, 972.2, 5126.0, 1906.4, 2200.0, 3863.47],
};

export const purchaseRecords = Object.entries(purchaseSeed).flatMap(([month, amounts]) =>
  amounts.map((amount, index) => ({
    id: `purchase-outlet-001-2026-${month}-${suppliers[index].id}`,
    outlet_id: "outlet-001",
    month: Number(month),
    year: 2026,
    supplier_id: suppliers[index].id,
    category_id: suppliers[index].default_category_id,
    remark: index === 0 && Number(month) === 5 ? "Fresh chicken" : "",
    amount,
    created_at: now,
    updated_at: now,
  })),
);

export const monthlyLocks = [
  {
    id: "lock-outlet-001-2026-5",
    outlet_id: "outlet-001",
    month: 5,
    year: 2026,
    is_locked: false,
    locked_by: "",
    locked_at: "",
    unlocked_by: "Marcus Lee",
    unlocked_at: now,
  },
];

export const importRuns = [
  {
    id: "import-001",
    file_name: "Sales_May2026.xlsx",
    import_type: "Sales",
    status: "success",
    imported_by: "Marcus Lee",
    created_at: "2026-05-20T08:20:00.000Z",
  },
];
