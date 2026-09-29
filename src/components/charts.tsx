import type { ReactNode } from "react";
import { useFloatingTip } from "./ui";

/** Barras horizontais (uma série, ordenadas) com valor na ponta e dica ao passar o mouse. */
export function BarList({
  rows,
  format,
  onClick,
  labelWidth,
}: {
  rows: { id: string; label: string; value: number; share?: number; detail?: ReactNode; dim?: boolean }[];
  format: (v: number) => string;
  onClick?: (id: string) => void;
  labelWidth?: number;
}) {
  const tip = useFloatingTip();
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <div className="barlist" role="list">
      {rows.map((r) => (
        <div
          key={r.id}
          role="listitem"
          className={`barrow ${r.dim ? "dim" : ""}`}
          style={{ cursor: onClick ? "pointer" : undefined, gridTemplateColumns: labelWidth ? `${labelWidth}px 1fr` : undefined }}
          onClick={() => onClick?.(r.id)}
          onMouseMove={(e) =>
            tip.show(
              e,
              <>
                <b>{r.label}</b>
                <div>
                  {format(r.value)}
                  {r.share !== undefined && ` · ${(r.share * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                </div>
                {r.detail && <div style={{ opacity: 0.75 }}>{r.detail}</div>}
              </>,
            )
          }
          onMouseLeave={tip.hide}
        >
          <div className="lbl" title={r.label}>{r.label}</div>
          <div className="plot">
            <div className="bar" style={{ width: `calc(${(r.value / max) * 100}% - ${(r.value / max) * 120}px)` }} />
            <span className="val">
              <b>{format(r.value)}</b>
              {r.share !== undefined && <span> · {(r.share * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>}
            </span>
          </div>
        </div>
      ))}
      {tip.node}
    </div>
  );
}

/** Barra empilhada 100% com legenda (identidade nunca só pela cor: a legenda traz valores). */
export function StackBar({
  parts,
  format,
  height = 22,
}: {
  parts: { label: string; value: number; color: string }[];
  format: (v: number) => string;
  height?: number;
}) {
  const tip = useFloatingTip();
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  return (
    <div>
      <div className="stack" style={{ height }}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div
              key={p.label}
              style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
              onMouseMove={(e) =>
                tip.show(
                  e,
                  <>
                    <b>{p.label}</b>
                    <div>
                      {format(p.value)} · {((p.value / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                    </div>
                  </>,
                )
              }
              onMouseLeave={tip.hide}
            />
          ))}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} />
            {p.label} <b className="num" style={{ color: "var(--ink)", fontWeight: 600 }}>{format(p.value)}</b>
            <span className="muted num">{((p.value / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
          </span>
        ))}
      </div>
      {tip.node}
    </div>
  );
}
