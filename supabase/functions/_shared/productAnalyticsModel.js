// Canonical Product Analytics model shared by Admin and the Agent Gateway.
export function normalizeProductName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function productKey(item) {
  return `${normalizeProductName(item.category_name)}::${normalizeProductName(item.product_name)}`;
}

export function variantKey(item) {
  return `${productKey(item)}::${normalizeProductName(item.variant_name || "Default")}`;
}

export function aggregateItems(items, options = {}) {
  const { includeVariants = false } = options;
  const byProduct = new Map();
  const byCategory = new Map();
  items.forEach((item) => {
    const key = includeVariants ? variantKey(item) : productKey(item);
    const variantName = String(item.variant_name ?? "").trim();
    const product = byProduct.get(key) ?? {
      key,
      product: item.product_name,
      variant: includeVariants ? variantName : "",
      category: item.category_name,
      quantity: 0,
      gross_sales: 0,
      nett_sales: 0,
      discount: 0,
      last_sold: item.created_at,
      variant_count: 0,
      variants: new Map(),
    };
    product.quantity += item.quantity;
    product.gross_sales += item.gross_sales;
    product.nett_sales += item.nett_sales;
    product.discount += item.discount;
    product.last_sold = item.created_at || product.last_sold;
    const variantDisplay = variantName || "Default";
    const variant = product.variants.get(variantDisplay) ?? {
      variant: variantDisplay,
      quantity: 0,
      gross_sales: 0,
      discount: 0,
      sst: 0,
      service_charge: 0,
      nett_sales: 0,
    };
    variant.quantity += item.quantity;
    variant.gross_sales += item.gross_sales;
    variant.discount += item.discount;
    variant.sst += item.sst;
    variant.service_charge += item.service_charge;
    variant.nett_sales += item.nett_sales;
    product.variants.set(variantDisplay, variant);
    product.variant_count = product.variants.size;
    byProduct.set(key, product);

    const category = byCategory.get(item.category_name) ?? { name: item.category_name, quantity: 0, nett_sales: 0 };
    category.quantity += item.quantity;
    category.nett_sales += item.nett_sales;
    byCategory.set(item.category_name, category);
  });
  const products = [...byProduct.values()].map((product) => ({
    ...product,
    variants: [...product.variants.values()].sort((a, b) => b.nett_sales - a.nett_sales),
  }));
  const categories = [...byCategory.values()].sort((a, b) => b.nett_sales - a.nett_sales);
  const totals = products.reduce((sum, item) => ({
    quantity: sum.quantity + item.quantity,
    nett_sales: sum.nett_sales + item.nett_sales,
    discount: sum.discount + item.discount,
  }), { quantity: 0, nett_sales: 0, discount: 0 });
  return { products, categories, totals };
}


export function rankProducts(products,by='sales') {
  const metric=by==='quantity'?'quantity':'nett_sales';
  return [...products].sort((a,b)=>b[metric]-a[metric]||a.key.localeCompare(b.key)).map((product,index)=>({...product,rank:index+1}));
}

export function mapProductItem(row) {
  return {
    id: row.id,
    report_id: row.report_id,
    outlet_id: row.outlet_id,
    category_name: row.category_name ?? "Uncategorized",
    product_name: row.product_name ?? "",
    variant_name: row.variant_name ?? "",
    quantity: Number(row.quantity ?? 0),
    gross_sales: Number(row.gross_sales ?? 0),
    discount: Number(row.discount ?? 0),
    sst: Number(row.sst ?? 0),
    service_charge: Number(row.service_charge ?? 0),
    nett_sales: Number(row.nett_sales ?? 0),
    created_at: row.created_at,
  };
}

