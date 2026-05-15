export default function DataTable({ columns, rows, getRowKey, footer, getRowClassName, onRowClick, density = "normal", tableClassName = "" }) {
  const cellPadding = density === "compact" ? "px-2.5 py-2" : "px-3 py-2.5";
  const headerPadding = density === "compact" ? "px-2.5 py-2" : "px-3 py-2.5";

  return (
    <div className="overflow-x-auto">
      <table className={`w-full min-w-[880px] border-collapse text-sm ${tableClassName}`}>
        <thead className="table-head">
          <tr>
            {columns.map((column) => (
              <th
                  key={column.key}
                  style={column.width ? { width: column.width } : undefined}
                  className={`${headerPadding} ${column.headerClassName ?? ""} ${column.align === "right" ? "text-right" : ""} ${
                  column.sticky ? "sticky left-0 z-10 bg-slate-50" : ""
                }`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-white">
          {rows.map((row, index) => (
            <tr
              key={getRowKey(row, index)}
              className={`transition hover:bg-slate-50/70 ${onRowClick ? "cursor-pointer" : ""} ${getRowClassName ? getRowClassName(row, index) : ""}`}
              onClick={onRowClick ? () => onRowClick(row, index) : undefined}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  style={column.width ? { width: column.width } : undefined}
                  className={`${cellPadding} align-middle ${column.className ?? ""} ${column.align === "right" ? "text-right" : ""} ${
                    column.sticky ? "sticky left-0 z-10 bg-white" : ""
                  }`}
                >
                  {column.render ? column.render(row, index) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot className="border-t border-border bg-slate-50">{footer}</tfoot> : null}
      </table>
    </div>
  );
}
