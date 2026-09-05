const semanticTones = new Set(["green", "amber", "red", "blue", "gray"]);

function toneOf(tone) {
  return semanticTones.has(tone) ? tone : "gray";
}

export function FactoryCellText({ primary, secondary, className = "" }) {
  return <div className={`factory-cell-text ${className}`}><div className="factory-cell-primary">{primary}</div>{secondary ? <div className="factory-cell-secondary">{secondary}</div> : null}</div>;
}

export function FactoryCellEntity({ name, code, className = "" }) {
  return <FactoryCellText primary={name} secondary={code} className={className} />;
}

export function FactoryCellDateTime({ date, time, className = "" }) {
  return <FactoryCellText primary={date} secondary={time} className={className} />;
}

export function FactoryCellSemanticText({ tone = "gray", children, className = "" }) {
  return <span className={`factory-cell-semantic ${className}`} data-tone={toneOf(tone)}><span aria-hidden="true" className="factory-cell-dot" />{children}</span>;
}

export function FactoryCellLabel({ tone = "gray", children, className = "" }) {
  return <span className={`factory-cell-label ${className}`} data-tone={toneOf(tone)}>{children}</span>;
}

export function FactoryCellAttention({ tone = "amber", children, className = "" }) {
  return <span className={`factory-cell-attention ${className}`} data-tone={toneOf(tone)}>{children}</span>;
}

export function FactoryCellProgress({ completed, required, tone = "gray", className = "" }) {
  return <span className={`factory-cell-progress ${className}`} data-tone={toneOf(tone)}>{completed}/{required}</span>;
}

export function FactoryCellMuted({ children = "—", className = "" }) {
  return <span className={`factory-cell-muted ${className}`}>{children}</span>;
}
