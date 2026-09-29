import { useState } from "react";
import { ChevronDown, Lock, RefreshCw } from "lucide-react";
import { Menu } from "./ui";
import { useApp } from "../lib/app";
import { CURRENCIES, CURRENCY_CODES, num, rateLabel, relativeTime } from "../../shared/format";
import type { CurrencyCode, CurrencySettings } from "../../shared/types";

/** Seletor da moeda de apresentação com cotação ao vivo ou fixada. */
export function CurrencyControl({ value, onChange }: { value: CurrencySettings; onChange: (c: CurrencySettings) => void }) {
  const { rates, rateOf, refreshRates, ratesOffline } = useApp();
  const [manual, setManual] = useState("");
  const live = value.display !== "BRL" ? rateOf(value.display) : 0;
  const stale = value.display !== "BRL" && value.mode === "live" && live && Math.abs(live - value.rate) / live > 0.0005;

  const pick = (code: CurrencyCode) => {
    if (code === "BRL") onChange({ ...value, display: "BRL" });
    else onChange({ ...value, display: code, foreign: code, rate: rateOf(code) || value.rate, mode: "live", rateAt: new Date().toISOString() });
  };

  return (
    <Menu
      align="right"
      width={300}
      trigger={(t) => (
        <button className="btn sm" {...t} title="Moeda de apresentação">
          <span style={{ fontWeight: 650 }}>{value.display}</span>
          {value.display !== "BRL" && (
            <span className="muted num" style={{ fontWeight: 500 }}>
              {num(value.rate, value.rate < 1 ? 5 : 4)}
              {value.mode === "manual" && <Lock size={11} style={{ marginLeft: 3, verticalAlign: -1 }} />}
            </span>
          )}
          <ChevronDown size={14} />
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="menu-label">Moeda de apresentação</div>
          <div style={{ maxHeight: 280, overflow: "auto" }}>
            {CURRENCY_CODES.map((c) => (
              <button key={c} className={`menu-item ${c === value.display ? "active" : ""}`} onClick={() => (pick(c), close())}>
                <b style={{ width: 34 }}>{c}</b>
                <span className="grow small ink2">{CURRENCIES[c].name}</span>
                <span className="kbd num">{c === "BRL" ? "base" : rateOf(c) ? num(rateOf(c), rateOf(c) < 1 ? 5 : 4) : "—"}</span>
              </button>
            ))}
          </div>
          {value.display !== "BRL" && (
            <>
              <div className="menu-sep" />
              <div style={{ padding: "6px 10px" }} className="col">
                <div className="small">
                  <b>{rateLabel(value.display, value.rate)}</b>
                  <div className="xs muted">
                    {value.mode === "live" ? "Cotação do dia (atualiza automaticamente)" : "Cotação fixada manualmente"}
                    {value.rateAt ? ` · ${relativeTime(value.rateAt)}` : ""}
                    {ratesOffline ? " · offline" : ""}
                  </div>
                  {stale && (
                    <button className="btn xs" style={{ marginTop: 6 }} onClick={() => onChange({ ...value, rate: live, rateAt: new Date().toISOString() })}>
                      Atualizar para {num(live, live < 1 ? 5 : 4)}
                    </button>
                  )}
                </div>
                <div className="row">
                  <input
                    className="input"
                    style={{ height: 30 }}
                    placeholder="Fixar cotação (R$)"
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const v = parseFloat(manual.replace(",", "."));
                      if (v > 0) {
                        onChange({ ...value, rate: v, mode: "manual", rateAt: new Date().toISOString() });
                        setManual("");
                        close();
                      }
                    }}
                  />
                  {value.mode === "manual" ? (
                    <button className="btn sm" onClick={() => (onChange({ ...value, mode: "live", rate: live || value.rate, rateAt: new Date().toISOString() }), close())}>
                      Ao vivo
                    </button>
                  ) : (
                    <button className="btn sm icon" title="Buscar cotação agora" onClick={() => refreshRates()}>
                      <RefreshCw size={14} />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
          {!rates.length && <div className="xs muted" style={{ padding: "4px 10px" }}>Cotações indisponíveis no momento.</div>}
        </div>
      )}
    </Menu>
  );
}
