// KPI Standard V3 — premium layout: optional icon → VALUE → label (no card accent lines).

function KpiCard({
  label,
  value,
  secondaryValue = null,
  trend = null,
  icon = null,
  onClick,
}) {
  const isInteractive = typeof onClick === "function";

  return (
    <div
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={isInteractive ? (e) => e.key === "Enter" && onClick(e) : undefined}
      className="kpi-card-v3"
      style={{
        ...cardStyle,
        cursor: isInteractive ? "pointer" : undefined,
      }}
    >
      {icon && (
        <span className="kpi-card-v3__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="kpi-card-v3__value">{value}</span>
      <span className="kpi-card-v3__label">{label}</span>
      {secondaryValue !== null && secondaryValue !== undefined && (
        <span className="kpi-card-v3__secondary-value">{secondaryValue}</span>
      )}
      {trend && <span className="kpi-card-v3__trend">{trend}</span>}
    </div>
  );
}

const cardStyle = {
  background: "var(--card)",
  borderRadius: "var(--radius-lg)",
  border: "1px solid var(--border)",
  boxShadow: "var(--shadow-kpi)",
  padding: "18px 20px",
  minHeight: "110px",
  height: "auto",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: "var(--space-2)",
  boxSizing: "border-box",
  minWidth: 0,
};

export default KpiCard;
