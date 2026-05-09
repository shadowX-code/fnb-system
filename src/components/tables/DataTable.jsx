export default function DataTable({ columns, rows, getRowKey, footer, getRowClassName }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse text-sm">
        <thead className="table-head">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-4 py-3 ${column.align === "right" ? "text-right" : ""} ${
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
              className={`transition hover:bg-slate-50/70 ${getRowClassName ? getRowClassName(row, index) : ""}`}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-4 py-3 align-middle ${column.align === "right" ? "text-right" : ""} ${
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
