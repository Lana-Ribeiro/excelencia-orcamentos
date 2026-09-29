import { useMemo, useState } from "react";
import { ArrowLeft, CircleAlert, FileSpreadsheet, Info, Redo2, Sparkles, Undo2 } from "lucide-react";
import { useProjectDoc } from "../lib/useProjectDoc";
import { ESTATICO } from "../lib/api";
import { go, useApp, useDownloadExcel } from "../lib/app";
import { Assistant } from "../components/Assistant";
import { CurrencyControl } from "../components/CurrencyControl";
import { NumberCell, TextCell } from "../components/cells";
import { SaveBadge } from "./Editor";
import { applyClientProposal } from "../lib/proposals";
import { SheetEvaluator } from "../../shared/formula";
import { dateBR, excelSerialToISO, money, num, pct } from "../../shared/format";
import type { ClientProject, TemplateField, TemplateItem } from "../../shared/types";

export function ClientEditor({ id }: { id: string }) {
  const { doc, payload, error, update, undo, redo, canUndo, canRedo, saveState, sync } = useProjectDoc<ClientProject>(id);
  const { rateOf } = useApp();
  const downloadExcel = useDownloadExcel();
  const [panel, setPanel] = useState(() => window.innerWidth > 1200 && !ESTATICO);
  const template = payload?.template;
  const cells = payload?.cells;

  const ev = useMemo(() => {
    if (!doc || !template || !cells) return null;
    const overrides: Record<string, string | number | null> = { ...doc.values };
    const { qty, unitPrice } = template.columns;
    for (const ref of template.staticTotals ?? []) {
      const row = ref.replace(/^[A-Z]+/, "");
      const q = overrides[`${qty}${row}`] ?? cells[`${qty}${row}`]?.v;
      const u = overrides[`${unitPrice}${row}`] ?? cells[`${unitPrice}${row}`]?.v;
      overrides[ref] = typeof q === "number" && typeof u === "number" ? q * u : 0;
    }
    return new SheetEvaluator(cells, overrides);
  }, [doc, template, cells]);

  if (error) return <div className="page"><div className="page-inner"><div className="banner bad">{error}</div></div></div>;
  if (!doc || !template || !cells || !ev) return <div className="page"><div className="page-inner muted">Abrindo orçamento…</div></div>;

  const c = template.columns;
  const val = (ref: string) => (ref in doc.values ? doc.values[ref] : cells[ref]?.v ?? null);
  const setVal = (ref: string, v: string | number | null) =>
    update((p) => {
      const values = { ...p.values, [ref]: v };
      const foreign = { ...(p.foreign ?? {}) };
      delete foreign[ref];
      return { ...p, values, foreign };
    });
  const numOr = (v: unknown) => (typeof v === "number" ? v : null);
  // zeros que vieram do modelo aparecem vazios (convidam ao preenchimento)
  const shown = (ref: string) => (ref in doc.values ? numOr(doc.values[ref]) : numOr(cells[ref]?.v) || null);
  const filled = (it: TemplateItem) => {
    const u = numOr(val(`${c.unitPrice}${it.row}`));
    return u !== null && u > 0;
  };
  const allItems = template.sections.flatMap((s) => s.items);
  const filledCount = allItems.filter(filled).length;
  const finalOut = template.outputs.find((o) => /valor final|total final|total geral/i.test(o.label)) ?? (template.grandTotalCell ? { cell: template.grandTotalCell, label: "Valor total", kind: "money" as const } : null);
  const grand = template.grandTotalCell ? ev.numeric(template.grandTotalCell) ?? 0 : 0;
  const finalValue = finalOut ? ev.numeric(finalOut.cell) ?? 0 : grand;
  const displayRate = doc.currency.display === "BRL" ? 1 : doc.currency.rate;

  return (
    <div className="editor">
      <header className="ehead" style={{ paddingBottom: 12 }}>
        <div className="ehead-top">
          <button className="btn ghost sm icon" onClick={() => go("/")} aria-label="Voltar">
            <ArrowLeft size={16} />
          </button>
          <div className="grow">
            <input className="ehead-title" value={doc.info.name} size={Math.max(12, doc.info.name.length)} onChange={(e) => update((p) => ({ ...p, info: { ...p.info, name: e.target.value } }))} aria-label="Nome do orçamento" />
            <div className="ehead-meta">
              <span className="badge gold">{template.name}</span>
              <span>{doc.info.client}</span>·<span>{filledCount} de {allItems.length} itens com preço</span>
            </div>
          </div>
          <SaveBadge state={saveState} sync={sync} />
          <div className="row" style={{ gap: 2 }}>
            <button className="btn ghost sm icon" title="Desfazer (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
              <Undo2 size={15} />
            </button>
            <button className="btn ghost sm icon" title="Refazer (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
              <Redo2 size={15} />
            </button>
          </div>
          <CurrencyControl value={doc.currency} onChange={(cur) => update((p) => ({ ...p, currency: cur }))} />
          <button className="btn sm" onClick={() => downloadExcel(doc.id)}>
            <FileSpreadsheet size={14} /> Planilha do cliente
          </button>
          <button className={`btn sm ${panel ? "primary" : ""}`} onClick={() => setPanel(!panel)}>
            <Sparkles size={14} /> Assistente
          </button>
        </div>
      </header>
      {sync?.lastError && (
        <div className="banner bad" style={{ margin: "10px 16px 0" }}>
          <CircleAlert size={16} />
          <div className="grow">{sync.lastError}</div>
        </div>
      )}

      <div className="ebody">
        <aside className="structure">
          <div className="structure-head">
            <span className="eyebrow">Seções</span>
            <span className="xs muted">{pct(allItems.length ? filledCount / allItems.length : 0, 0)} preenchido</span>
          </div>
          <div className="structure-list">
            {template.sections.map((s) => {
              const done = s.items.filter(filled).length;
              return (
                <button key={s.row} className="snode" onClick={() => document.getElementById(`sec-${s.row}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  <span className="nm" title={s.title}>{s.code} {s.title}</span>
                  <span className="vl">{s.totalCell ? money(ev.numeric(s.totalCell) ?? 0, "BRL", { compact: true }) : ""}</span>
                  <span className="progress" style={{ gridColumn: "1 / -1" }}>
                    <i style={{ width: `${s.items.length ? (done / s.items.length) * 100 : 0}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="page" style={{ background: "var(--page)" }}>
          <div style={{ maxWidth: 1180, margin: "0 auto", padding: "20px 24px 40px" }}>
            <div className="banner info" style={{ marginBottom: 16 }}>
              <Info size={16} />
              <div className="small">
                Estrutura e fórmulas pertencem ao modelo do cliente e não são alteradas. Você preenche quantidades, preços e observações; os totais abaixo são calculados com as fórmulas da própria planilha. Preços aceitam moeda: “120 usd”.
              </div>
            </div>

            {!!template.fields.length && (
              <div className="card card-pad" style={{ marginBottom: 18 }}>
                <div className="section-title">Dados da proposta</div>
                <div className="grid3">
                  {template.fields.map((f) => (
                    <FieldInput key={f.cell} f={f} value={f.cell in doc.values ? doc.values[f.cell] : f.defaultValue ?? null} onChange={(v) => setVal(f.cell, v)} />
                  ))}
                </div>
              </div>
            )}

            {template.sections.map((s) => (
              <div key={s.row} id={`sec-${s.row}`} className="cl-section">
                <div className="cl-sechead">
                  <span className="muted num">{s.code}</span>
                  <span className="grow">{s.title}</span>
                  {s.totalCell && <span className="num">{money(ev.numeric(s.totalCell) ?? 0)}</span>}
                </div>
                <table className="cl-table">
                  <thead>
                    <tr>
                      <th style={{ width: 58 }}>Item</th>
                      <th>Atividade</th>
                      {c.qty && <th className="r" style={{ width: 92 }}>Qtd</th>}
                      {c.unit && <th style={{ width: 70 }}>Un.</th>}
                      {c.unitPrice && <th className="r" style={{ width: 128 }}>Preço unit.</th>}
                      {c.total && <th className="r" style={{ width: 128 }}>Total</th>}
                      {c.applicable && <th style={{ width: 82 }}>Aplicável</th>}
                      {c.obs && <th style={{ width: "22%" }}>Observações</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {s.items.map((it) => {
                      const ref = (col?: string) => `${col}${it.row}`;
                      const tot = c.total ? ev.numeric(ref(c.total)) : null;
                      const fx = c.unitPrice ? doc.foreign?.[ref(c.unitPrice)] : undefined;
                      return (
                        <tr key={it.row} className={filled(it) ? "filled" : ""}>
                          <td className="muted num small" style={{ paddingLeft: 12 }}>{it.code}</td>
                          <td>
                            {it.editable.desc ? (
                              <TextCell value={(val(ref(c.desc)) as string) ?? ""} placeholder="Descreva o item complementar" onCommit={(v) => setVal(ref(c.desc), v || null)} nav="cdesc" />
                            ) : (
                              <div className="ro">{it.desc}</div>
                            )}
                          </td>
                          {c.qty && (
                            <td>
                              {it.editable.qty ? (
                                <NumberCell value={shown(ref(c.qty))} nav="cqty" placeholder="0" ariaLabel={`Quantidade linha ${it.row}`} onCommit={(r) => setVal(ref(c.qty), r.value)} />
                              ) : (
                                <div className="ro r num">{num(numOr(val(ref(c.qty))) ?? 0)}</div>
                              )}
                            </td>
                          )}
                          {c.unit && (
                            <td>
                              {it.editable.unit ? <TextCell value={(val(ref(c.unit)) as string) ?? ""} list="units-c" nav="cunit" placeholder="un" onCommit={(v) => setVal(ref(c.unit), v.trim() || null)} /> : <div className="ro">{String(val(ref(c.unit)) ?? "")}</div>}
                            </td>
                          )}
                          {c.unitPrice && (
                            <td>
                              {it.editable.unitPrice ? (
                                <NumberCell
                                  value={shown(ref(c.unitPrice))}
                                  nav="cprice"
                                  ariaLabel={`Preço unitário linha ${it.row}`}
                                  placeholder="—"
                                  rateOf={rateOf}
                                  badge={fx?.currency}
                                  onCommit={(r) =>
                                    update((p) => {
                                      const key = ref(c.unitPrice);
                                      const values = { ...p.values, [key]: r.value };
                                      const foreign = { ...(p.foreign ?? {}) };
                                      if (r.foreign) foreign[key] = { currency: r.foreign.currency, rate: r.foreign.rate, material: r.foreign.amount, at: new Date().toISOString() };
                                      else delete foreign[key];
                                      return { ...p, values, foreign };
                                    })
                                  }
                                />
                              ) : (
                                <div className="ro r num">{num(numOr(val(ref(c.unitPrice))) ?? 0)}</div>
                              )}
                            </td>
                          )}
                          {c.total && <td className="r num" style={{ fontWeight: 600, paddingRight: 12 }}>{tot ? money(tot) : <span className="muted">—</span>}</td>}
                          {c.applicable && (
                            <td>
                              {it.editable.applicable ? (
                                <select className="cell" value={String(val(ref(c.applicable)) ?? "").toLowerCase()} onChange={(e) => setVal(ref(c.applicable), e.target.value || null)}>
                                  <option value="">—</option>
                                  <option value="sim">sim</option>
                                  <option value="não">não</option>
                                </select>
                              ) : (
                                <div className="ro">{String(val(ref(c.applicable)) ?? "")}</div>
                              )}
                            </td>
                          )}
                          {c.obs && (
                            <td>
                              {it.editable.obs ? <TextCell value={(val(ref(c.obs)) as string) ?? ""} nav="cobs" placeholder="—" onCommit={(v) => setVal(ref(c.obs), v || null)} /> : <div className="ro">{String(val(ref(c.obs)) ?? "")}</div>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}

            {(template.params.length > 0 || template.outputs.length > 0) && (
              <div className="two" style={{ marginTop: 8 }}>
                <div className="card card-pad">
                  <div className="section-title">Parâmetros do cliente</div>
                  <div className="col" style={{ gap: 12 }}>
                    {template.params.map((f) => (
                      <FieldInput key={f.cell} f={f} value={f.cell in doc.values ? doc.values[f.cell] : f.defaultValue ?? null} onChange={(v) => setVal(f.cell, v)} inline />
                    ))}
                  </div>
                </div>
                <div className="card card-pad">
                  <div className="section-title">Resultados da planilha</div>
                  <div className="kv">
                    {template.outputs.map((o) => {
                      const v = ev.numeric(o.cell);
                      return (
                        <FragmentKV key={o.cell} k={o.label} v={v === null ? "—" : o.kind === "percent" ? pct(v) : money(v)} strong={o === finalOut} />
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
          <datalist id="units-c">
            {["un", "vb", "m²", "m", "ml", "m³", "pontos", "pç", "cj", "kg", "dia", "mês", "uni"].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>

        {panel && <Assistant project={doc} template={template} onApply={(prop) => update((p) => applyClientProposal(p, template, prop, rateOf))} onClose={() => setPanel(false)} />}
      </div>

      <footer className="summary">
        <div className="sum-item">
          <span className="k">Itens com preço</span>
          <span className="v">{filledCount} / {allItems.length}</span>
        </div>
        {template.grandTotalCell && (
          <div className="sum-item">
            <span className="k">Valor total dos itens</span>
            <span className="v">{money(grand)}</span>
          </div>
        )}
        <div className="sum-item total">
          <span className="k">{finalOut?.label ?? "Valor final"}</span>
          <span className="v">{money(finalValue / displayRate, doc.currency.display)}</span>
          {doc.currency.display !== "BRL" && <span className="alt">{money(finalValue)}</span>}
        </div>
      </footer>
    </div>
  );
}

function FragmentKV({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <>
      <span className="k" style={strong ? { fontWeight: 650, color: "var(--ink)" } : undefined}>{k}</span>
      <span className="v" style={strong ? { fontSize: 16 } : undefined}>{v}</span>
    </>
  );
}

function FieldInput({ f, value, onChange, inline }: { f: TemplateField; value: string | number | boolean | null; onChange: (v: string | number | null) => void; inline?: boolean }) {
  const label = <label title={f.cell}>{f.label}</label>;
  let input;
  if (f.kind === "date") {
    const iso = typeof value === "number" ? excelSerialToISO(value) : typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
    input = <input className="input" type="date" value={iso} onChange={(e) => onChange(e.target.value || null)} title={iso ? dateBR(iso) : ""} />;
  } else if (f.kind === "percent") {
    input = (
      <div className="input-affix">
        <input
          className="input"
          key={String(value)}
          defaultValue={typeof value === "number" ? (value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 }) : ""}
          onBlur={(e) => {
            const v = parseFloat(e.target.value.replace(",", "."));
            onChange(isFinite(v) ? v / 100 : null);
          }}
        />
        <span className="affix">%</span>
      </div>
    );
  } else if (f.kind === "number") {
    input = (
      <input
        className="input"
        key={String(value)}
        inputMode="decimal"
        defaultValue={typeof value === "number" ? value.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) : String(value ?? "")}
        onBlur={(e) => {
          const t = e.target.value.trim();
          const v = parseFloat(t.replace(/\./g, "").replace(",", "."));
          onChange(t === "" ? null : isFinite(v) ? v : t);
        }}
      />
    );
  } else {
    input = <input className="input" key={String(value)} defaultValue={String(value ?? "")} onBlur={(e) => e.target.value !== String(value ?? "") && onChange(e.target.value || null)} />;
  }
  return inline ? (
    <div className="row" style={{ gap: 12 }}>
      <div className="grow small">{f.label}</div>
      <div style={{ width: f.kind === "text" ? 260 : 140 }}>{input}</div>
    </div>
  ) : (
    <div className="field">
      {label}
      {input}
    </div>
  );
}
