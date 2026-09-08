import { FactoryCellEntity, FactoryCellMuted, FactoryCellSemanticText } from "../FactoryTableCell.jsx";
import { money, percent } from "../../utils/factoryFormatters.js";

function FinishedGoodName({ sku, mobile = false }) {
  const englishName = sku.product_family_name || sku.product_name_en || sku.product_name || "—";
  const chineseName = sku.product_family_name_cn || sku.product_name_cn;
  return (
    <div className={mobile ? "min-w-0" : ""}>
      <FactoryCellEntity name={englishName} code={chineseName || ""} />
    </div>
  );
}

function FinishedGoodCommercialValue({ value, format }) {
  return <div className="font-semibold text-text-primary">{value == null ? "—" : format(value)}</div>;
}

export default function FactoryFinishedGoodCommercialTable({ rows, renderActions, formatPackSize, formatStorage }) {
  return (
    <div className="factory-finished-goods-table">
      <div className="divide-y divide-border md:hidden">
        {rows.map((sku) => (
          <div key={sku.id} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <FinishedGoodName sku={sku} mobile />
                <div className="mt-1 text-xs font-semibold text-text-muted">{sku.product_code || "—"} · {formatPackSize(sku) || "—"}</div>
              </div>
              <FactoryCellSemanticText tone={sku.is_halal ? "green" : "gray"}>{sku.is_halal ? "Halal" : "No"}</FactoryCellSemanticText>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-[10.5px] font-semibold text-text-muted">Storage</div><div className="font-semibold text-text-primary">{formatStorage(sku)}</div></div>
              <div><div className="text-[10.5px] font-semibold text-text-muted">Shelf Life</div><div className="font-semibold text-text-primary">{sku.shelf_life_days ? `${sku.shelf_life_days} days` : "—"}</div></div>
              <div><div className="text-[10.5px] font-semibold text-text-muted">Cost</div><FinishedGoodCommercialValue value={sku.commercial_cost} format={money} /></div>
              <div><div className="text-[10.5px] font-semibold text-text-muted">B2B Price</div><FinishedGoodCommercialValue value={sku.b2b_price} format={money} /></div>
              <div><div className="text-[10.5px] font-semibold text-text-muted">Gross Margin</div><FinishedGoodCommercialValue value={sku.gross_margin} format={percent} /></div>
              <div><div className="text-[10.5px] font-semibold text-text-muted">Category</div><div className="font-semibold text-text-primary">{sku.category || "—"}</div></div>
            </div>
            {renderActions(sku)}
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="factory-table w-full min-w-[1320px] text-left">
          <thead><tr className="factory-table-header border-b border-border text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted"><th className="px-4 py-2.5">Category</th><th className="px-4 py-2.5">Product</th><th className="px-4 py-2.5">Halal</th><th className="px-4 py-2.5">SKU</th><th className="px-4 py-2.5">Pack Size</th><th className="px-4 py-2.5">Storage</th><th className="px-4 py-2.5">Shelf Life</th><th className="px-4 py-2.5 text-right">Cost</th><th className="px-4 py-2.5 text-right">B2B Price</th><th className="px-4 py-2.5 text-right">Gross Margin</th><th className="px-4 py-2.5 text-right">Actions</th></tr></thead>
          <tbody>{rows.map((sku) => <tr key={sku.id} className="factory-table-row-neutral border-b border-border text-sm last:border-0"><td className="px-4 py-3 font-semibold text-text-secondary">{sku.category || <FactoryCellMuted />}</td><td className="px-4 py-3"><FinishedGoodName sku={sku} /></td><td className="px-4 py-3"><FactoryCellSemanticText tone={sku.is_halal ? "green" : "gray"}>{sku.is_halal ? "Halal" : "No"}</FactoryCellSemanticText></td><td className="px-4 py-3 font-semibold text-text-primary">{sku.product_code || <FactoryCellMuted />}</td><td className="px-4 py-3 whitespace-nowrap">{formatPackSize(sku) || <FactoryCellMuted />}</td><td className="px-4 py-3">{formatStorage(sku)}</td><td className="px-4 py-3 whitespace-nowrap">{sku.shelf_life_days ? `${sku.shelf_life_days} days` : <FactoryCellMuted />}</td><td className="px-4 py-3 text-right"><FinishedGoodCommercialValue value={sku.commercial_cost} format={money} /></td><td className="px-4 py-3 text-right"><FinishedGoodCommercialValue value={sku.b2b_price} format={money} /></td><td className="px-4 py-3 text-right"><FinishedGoodCommercialValue value={sku.gross_margin} format={percent} /></td><td className="px-4 py-3 text-right">{renderActions(sku)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
