import { Fragment } from 'react';
import {ArrowDown, ArrowUp, ArrowUpDown} from 'lucide-react';
import './tableControls.css';

export function shouldIgnoreRowClick(event) {
    const selection = window.getSelection?.();
    if (event.type === "click" && selection?.toString() && event.currentTarget.contains(selection.anchorNode)) return true;
    const control = event.target.closest("button, a, input, select, textarea, summary, [contenteditable='true'], [role='button'], [data-row-action='true']");
    return Boolean(control && control !== event.currentTarget);
  }

export default function DataTable({ columns, rows, getRowKey, footer, getRowClassName, getRowProps, onRowClick, renderExpandedRow, renderGroupRow, density = "normal", columnSpacing = "normal", tableClassName = "", minWidth = 880, mobileLayout = "scroll" }) {


  const twoLine = mobileLayout === "two-line";
  return (
    <div className="data-table-scroll admin-data-table-scroll overflow-x-auto">
      <table className={`admin-data-table w-full border-collapse ${tableClassName}`} role={twoLine ? "table" : undefined} data-mobile-layout={mobileLayout} data-density={density} data-column-spacing={columnSpacing} style={{minWidth}}>
        <thead role={twoLine ? "rowgroup" : undefined} className="table-head admin-table-head">
          <tr role={twoLine ? "row" : undefined}>
            {columns.map((column) => (
              <th
                  key={column.key}
                  role={twoLine ? "columnheader" : undefined}
                  scope="col"
                  data-mobile-span={twoLine ? column.mobileSpan : undefined}
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
        <tbody role={twoLine ? "rowgroup" : undefined} className="table-body divide-y divide-border">
          {rows.map((row, index) => {
            const group = renderGroupRow?.(row, index);
            if (group) return <tr key={getRowKey(row,index)} className={`admin-table-group admin-table-group--${group.level || 'domain'}`}><th colSpan={columns.length} scope="rowgroup">{group.content}</th></tr>;
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
            const expanded = renderExpandedRow?.(row, index);
            return (
              <Fragment key={getRowKey(row, index)}>
                <tr
                  role={twoLine ? "row" : undefined}
                  className={`table-row admin-table-row transition ${rowOnClick ? "cursor-pointer" : ""} ${getRowClassName ? getRowClassName(row, index) : ""} ${rowClassName}`}
                  onClick={rowOnClick}
                  {...restRowProps}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      role={twoLine ? "cell" : undefined}
                      data-mobile-span={twoLine ? column.mobileSpan : undefined}
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
                {expanded && <tr className="admin-table-row"><td colSpan={columns.length} className="admin-table-cell w-full max-[700px]:!pr-0">{expanded}</td></tr>}
              </Fragment>
            );
          })}
        </tbody>
        {footer ? <tfoot className="table-summary-row border-t border-border">{footer}</tfoot> : null}
      </table>
    </div>
  );
}
