import { useEffect, useState } from "react";
import { ArrowRightLeft, Copy, Plus, Trash2, X } from "lucide-react";
import { NumberCell, TextCell } from "../components/cells";
import type { BudgetCalc } from "../../shared/calc";
import { SPEC_FIELDS, UNITS, suggestSpecFields } from "../../shared/catalog";
import { CURRENCIES, CURRENCY_CODES, money, num, pct } from "../../shared/format";
import type { BudgetNode, CurrencyCode, TopsiteProject } from "../../shared/types";
import type { SheetOps } from "./BudgetSheet";

const PREMISSAS = [
  "Considerado material e mão de obra",
  "Considerado somente mão de obra",
  "Material fornecido pelo cliente",
  "Não considerado ",
  "Estimativa — validar com fornecedor",
];

export function Inspector({
  project,
  node,
  calc,
  ops,
  rateOf,
  onClose,
}: {
  project: TopsiteProject;
  node: BudgetNode;
  calc: BudgetCalc;
  ops: SheetOps;
  rateOf: (c: CurrencyCode) => number;
  onClose: () => void;
}) {
  const c = calc.byId.get(node.id)!;
  const discipline = c.path[0] ?? "";
  const [priceCur, setPriceCur] = useState<CurrencyCode>(node.foreign?.currency ?? "BRL");
  useEffect(() => setPriceCur(node.foreign?.currency ?? "BRL"), [node.id, node.foreign?.currency]);
  const rate = priceCur === "BRL" ? 1 : node.foreign?.currency === priceCur ? node.foreign.rate : rateOf(priceCur);

  const specs = node.specs ?? [];
  const suggested = suggestSpecFields(discipline, node.description).filter((k) => !specs.some((s) => s.key === k));
  const setSpecs = (next: typeof specs) => ops.patch(node.id, { specs: next });

  const setPrice = (field: "material" | "labor", amount: number | null, expr?: string) => {
    if (priceCur === "BRL") {
      const foreign = node.foreign ? { ...node.foreign, [field]: null } : undefined;
      const stillForeign = foreign && (foreign.material || foreign.labor);
      ops.patch(node.id, { [field]: amount, [`${field}Expr`]: expr, foreign: stillForeign ? foreign : undefined });
      return;
    }
    const base = node.foreign?.currency === priceCur ? node.foreign : { currency: priceCur, rate, material: null, labor: null, at: new Date().toISOString() };
    ops.patch(node.id, {
      [field]: amount === null ? null : Math.round(amount * rate * 100) / 100,
      [`${field}Expr`]: undefined,
      foreign: { ...base, [field]: amount, rate, at: new Date().toISOString() },
    });
  };
  const foreignValue = (field: "material" | "labor") =>
    priceCur === "BRL" ? node[field] ?? null : node.foreign?.currency === priceCur ? (node.foreign[field] ?? null) : node[field] ? node[field]! / rate : null;

  const reconvert = () => {
    if (!node.foreign) return;
    const r = rateOf(node.foreign.currency);
    if (!r) return;
    ops.patch(node.id, {
      material: node.foreign.material != null ? Math.round(node.foreign.material * r * 100) / 100 : node.material,
      labor: node.foreign.labor != null ? Math.round(node.foreign.labor * r * 100) / 100 : node.labor,
      foreign: { ...node.foreign, rate: r, at: new Date().toISOString() },
    });
  };

  return (
    <div className="side">
      <div className="side-head">
        <div className="grow">
          <div className="xs muted">{c.path.join(" › ")}</div>
          <div className="h3">Item {c.code}</div>
        </div>
        <button className="btn ghost sm icon" onClick={onClose} aria-label="Fechar detalhes">
          <X size={16} />
        </button>
      </div>
      <div className="side-body">
        <div className="field">
          <label>Descrição</label>
          <textarea
            key={node.id + "d" + node.description}
            className="textarea"
            style={{ minHeight: 58 }}
            defaultValue={node.description}
            onBlur={(e) => e.target.value !== node.description && ops.patch(node.id, { description: e.target.value })}
          />
        </div>

        <div className="grid2">
          <div className="field">
            <label>Unidade</label>
            <select className="select" value={UNITS.includes(node.unit ?? "") ? node.unit : node.unit ? "__other" : ""} onChange={(e) => e.target.value !== "__other" && ops.patch(node.id, { unit: e.target.value })}>
              <option value="">—</option>
              {UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
              {node.unit && !UNITS.includes(node.unit) && <option value="__other">{node.unit}</option>}
            </select>
          </div>
          <div className="field">
            <label>Quantidade</label>
            <div className="card" style={{ boxShadow: "inset 0 0 0 1px var(--line-strong)" }}>
              <NumberCell value={node.qty} expr={node.qtyExpr} placeholder="0" ariaLabel="Quantidade" onCommit={(r) => ops.patch(node.id, { qty: r.value, qtyExpr: r.expr })} />
            </div>
            <span className="hint">Aceita memória de cálculo: 135,4*1,2</span>
          </div>
        </div>

        <div>
          <div className="section-title">
            <span>Custo unitário</span>
            <select className="select" style={{ width: 118, height: 28, fontSize: 12 }} value={priceCur} onChange={(e) => setPriceCur(e.target.value as CurrencyCode)} aria-label="Moeda do preço">
              {CURRENCY_CODES.map((cc) => (
                <option key={cc} value={cc}>
                  {cc} · {CURRENCIES[cc].symbol}
                </option>
              ))}
            </select>
          </div>
          <div className="grid2">
            <div className="field">
              <label>Material ({CURRENCIES[priceCur].symbol})</label>
              <div className="card" style={{ boxShadow: "inset 0 0 0 1px var(--line-strong)" }}>
                <NumberCell value={foreignValue("material")} expr={priceCur === "BRL" ? node.materialExpr : undefined} placeholder="0,00" ariaLabel="Material" onCommit={(r) => setPrice("material", r.value, r.expr)} />
              </div>
            </div>
            <div className="field">
              <label>Mão de obra ({CURRENCIES[priceCur].symbol})</label>
              <div className="card" style={{ boxShadow: "inset 0 0 0 1px var(--line-strong)" }}>
                <NumberCell value={foreignValue("labor")} expr={priceCur === "BRL" ? node.laborExpr : undefined} placeholder="0,00" ariaLabel="Mão de obra" onCommit={(r) => setPrice("labor", r.value, r.expr)} />
              </div>
            </div>
          </div>
          {priceCur !== "BRL" && (
            <div className="conv" style={{ marginTop: 8 }}>
              <ArrowRightLeft size={13} />
              <span className="grow">
                {money((foreignValue("material") ?? 0) + (foreignValue("labor") ?? 0), priceCur)} × {num(rate, rate < 1 ? 5 : 4)} = <b>{money(c.unitCost)}</b>
              </span>
            </div>
          )}
          {node.foreign && priceCur === node.foreign.currency && rateOf(node.foreign.currency) && Math.abs(rateOf(node.foreign.currency) - node.foreign.rate) > 1e-6 && (
            <div className="conv" style={{ marginTop: 6, background: "var(--warn-bg)" }}>
              <span className="grow">Convertido a {num(node.foreign.rate, 4)}; hoje {num(rateOf(node.foreign.currency), 4)}.</span>
              <button className="btn xs" onClick={reconvert}>Reconverter</button>
            </div>
          )}
          <div className="kv" style={{ marginTop: 12 }}>
            <span className="k">Unitário (R$)</span>
            <span className="v">{money(c.unitCost)}</span>
            <span className="k">Total de custo</span>
            <span className="v">{money(c.cost)}</span>
          </div>
        </div>

        <div>
          <div className="section-title"><span>Venda</span></div>
          <div className="grid2">
            <div className="field">
              <label>Índice individual</label>
              <div className="input-affix">
                <input
                  key={node.id + "mk" + (node.markup ?? "")}
                  className="input"
                  defaultValue={node.markup ? num(node.markup * 100) : ""}
                  placeholder="0"
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value.replace(",", "."));
                    ops.patch(node.id, { markup: isFinite(v) && v ? v / 100 : undefined });
                  }}
                />
                <span className="affix">%</span>
              </div>
            </div>
            <div className="kv" style={{ alignContent: "end", paddingBottom: 8 }}>
              <span className="k">Fator</span>
              <span className="v">× {num(c.factor, 4)}</span>
            </div>
          </div>
          <div className="kv" style={{ marginTop: 10 }}>
            <span className="k">Unitário de venda</span>
            <span className="v">{money(c.unitSale)}</span>
            <span className="k">Total de venda</span>
            <span className="v">{money(c.sale)}</span>
            <span className="k">Participação no orçamento</span>
            <span className="v">{calc.sale ? pct(c.sale / calc.sale, 2) : "—"}</span>
            {project.info.area ? (
              <>
                <span className="k">Por m² da obra</span>
                <span className="v">{money(c.sale / project.info.area)}</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="field">
          <label>Fornecedor / observações</label>
          <input key={node.id + "s" + (node.supplier ?? "")} className="input" defaultValue={node.supplier ?? ""} placeholder="Ex.: Fornecedor X — proposta 1234" onBlur={(e) => e.target.value !== (node.supplier ?? "") && ops.patch(node.id, { supplier: e.target.value })} />
        </div>

        <div className="field">
          <label>Comentários e premissas</label>
          <textarea
            key={node.id + "c" + (node.comments ?? "")}
            className="textarea"
            defaultValue={node.comments ?? ""}
            placeholder="O que foi considerado e o que não foi"
            onBlur={(e) => e.target.value !== (node.comments ?? "") && ops.patch(node.id, { comments: e.target.value })}
          />
          <div className="quick">
            {PREMISSAS.map((p) => (
              <button key={p} className="chip dashed" style={{ height: 22, fontSize: 11.5 }} onClick={() => ops.patch(node.id, { comments: [node.comments?.trim(), p].filter(Boolean).join("\n") })}>
                {p.trim()}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="section-title">
            <span>Especificações</span>
            <span className="xs muted" style={{ textTransform: "none", letterSpacing: 0 }}>vão para a coluna Comentários</span>
          </div>
          <div className="col" style={{ gap: 6 }}>
            {specs.map((s, i) => (
              <div key={i} className="spec-row">
                <TextCell value={s.key} className="small" onCommit={(v) => setSpecs(specs.map((x, j) => (j === i ? { ...x, key: v } : x)))} ariaLabel="Campo" />
                <div className="card" style={{ boxShadow: "inset 0 0 0 1px var(--line-strong)" }}>
                  <TextCell
                    value={s.value}
                    list={`opts-${i}`}
                    placeholder={SPEC_FIELDS[s.key]?.hint ?? "valor"}
                    onCommit={(v) => setSpecs(specs.map((x, j) => (j === i ? { ...x, value: v } : x)))}
                    ariaLabel={`Valor de ${s.key}`}
                  />
                  <datalist id={`opts-${i}`}>
                    {(SPEC_FIELDS[s.key]?.options ?? []).map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                </div>
                <button className="btn ghost xs icon" aria-label="Remover" onClick={() => setSpecs(specs.filter((_, j) => j !== i))}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="quick" style={{ marginTop: 8 }}>
            {suggested.slice(0, 8).map((k) => (
              <button key={k} className="chip dashed" style={{ height: 22, fontSize: 11.5 }} onClick={() => setSpecs([...specs, { key: k, value: "" }])}>
                <Plus size={11} /> {k}
              </button>
            ))}
            <button className="chip dashed" style={{ height: 22, fontSize: 11.5 }} onClick={() => setSpecs([...specs, { key: "Campo", value: "" }])}>
              <Plus size={11} /> Outro
            </button>
          </div>
        </div>

        <div className="row" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <button className="btn sm" onClick={() => ops.duplicate(node.id)}>
            <Copy size={14} /> Duplicar
          </button>
          <div className="grow" />
          <button className="btn ghost sm danger" onClick={() => ops.remove(node.id)}>
            <Trash2 size={14} /> Excluir
          </button>
        </div>
      </div>
    </div>
  );
}
