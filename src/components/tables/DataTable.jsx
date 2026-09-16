export default function DataTable({ columns, rows, getRowKey, footer, getRowClassName, getRowProps, onRowClick, density = "normal", tableClassName = "" }) {
  function shouldIgnoreRowClick(event) {
    return Boolean(event.target.closest("button, a, input, select, textarea, [role='button'], [data-row-action='true']"));
  }

  return (
    <div className="data-table-scroll admin-data-table-scroll overflow-x-auto">
      <table className={`admin-data-table w-full min-w-[880px] border-collapse ${tableClassName}`} data-density={density}>
        <thead className="table-head admin-table-head">
          <tr>
            {columns.map((column) => (
              <th
                  key={column.key}
                  style={column.width ? { width: column.width } : undefined}
                  className={`admin-table-header-cell ${column.headerClassName ?? ""} ${column.align === "right" ? "text-right" : ""} ${
                  column.sticky ? "table-sticky-cell sticky left-0 z-10" : ""
                }`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="table-body divide-y divide-border">
          {rows.map((row, index) => {
            const rowProps = getRowProps ? getRowProps(row, index) : {};
            const rowClassName = rowProps.className ?? "";
            const rawRowOnClick = rowProps.onClick ?? (onRowClick ? () => onRowClick(row, index) : undefined);
            const rowOnClick = rawRowOnClick
              ? (event) => {
                if (shouldIgnoreRowClick(event)) return;
                rawRowOnClick(event);
              }
              : undefined;
            const { className: _className, onClick: _onClick, ...restRowProps } = rowProps;
            return (
              <tr
                key={getRowKey(row, index)}
                className={`table-row admin-table-row transition ${rowOnClick ? "cursor-pointer" : ""} ${getRowClassName ? getRowClassName(row, index) : ""} ${rowClassName}`}
                onClick={rowOnClick}
                {...restRowProps}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    style={column.width ? { width: column.width } : undefined}
                    className={`admin-table-cell align-middle ${column.className ?? ""} ${column.align === "right" ? "text-right" : ""} ${
                      column.sticky ? "table-sticky-cell sticky left-0 z-10" : ""
                    }`}
                  >
                    {column.render ? column.render(row, index) : row[column.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {footer ? <tfoot className="table-summary-row border-t border-border">{footer}</tfoot> : null}
      </table>
    </div>
  );
}
