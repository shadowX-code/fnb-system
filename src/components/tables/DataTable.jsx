import {ArrowDown, ArrowUp, ArrowUpDown} from 'lucide-react';
import './tableControls.css';

export function shouldIgnoreRowClick(event) {
    const selection = window.getSelection?.();
    if (event.type === "click" && selection?.toString() && event.currentTarget.contains(selection.anchorNode)) return true;
    const control = event.target.closest("button, a, input, select, textarea, summary, [contenteditable='true'], [role='button'], [data-row-action='true']");
    return Boolean(control && control !== event.currentTarget);
  }

export default function DataTable({ columns, rows, getRowKey, footer, getRowClassName, getRowProps, onRowClick, density = "normal", columnSpacing = "normal", tableClassName = "", minWidth = 880, mobileLayout = "scroll" }) {


  return (
    <div className="data-table-scroll admin-data-table-scroll overflow-x-auto">
      <table className={`admin-data-table w-full border-collapse ${tableClassName}`} data-mobile-layout={mobileLayout} data-density={density} data-column-spacing={columnSpacing} style={{minWidth}}>
        <thead className="table-head admin-table-head">
          <tr>
            {columns.map((column) => (
              <th
                  key={column.key}
                  data-priority={column.priority}
                  aria-sort={column.onSort ? column.sortDirection === 'asc' ? 'ascending' : column.sortDirection === 'desc' ? 'descending' : 'none' : undefined}
                  style={column.width ? { width: column.width } : undefined}
                  className={`admin-table-header-cell ${column.headerClassName ?? ""} ${column.align === "right" ? "text-right" : ""} ${
                  column.sticky ? "table-sticky-cell sticky left-0 z-10" : ""
                }`}
              >
                {column.onSort ? <button type="button" className="admin-table-sort" onClick={column.onSort} aria-label={`Sort by ${column.header}${column.sortDirection === 'asc' ? ', descending' : ', ascending'}`}>
                  <span>{column.header}</span>{column.sortDirection === 'asc' ? <ArrowUp size={14} aria-hidden="true"/> : column.sortDirection === 'desc' ? <ArrowDown size={14} aria-hidden="true"/> : <ArrowUpDown size={14} aria-hidden="true"/>}
                </button> : column.header}
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
                    data-priority={column.priority}
                    data-label={typeof column.header === "string" ? column.header : undefined}
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
