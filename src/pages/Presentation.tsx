import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { api } from "../lib/api";
import { go, useApp } from "../lib/app";
import { BarList, StackBar } from "../components/charts";
import { Segmented } from "../components/ui";
import { computeInsights } from "../lib/insights";
import { computeBudget, fromBRL } from "../../shared/calc";
import { CURRENCIES, CURRENCY_CODES, dateBR, money, num, pct, rateLabel } from "../../shared/format";
import type { BudgetNode, CurrencyCode, TopsiteProject } from "../../shared/types";

export function Presentation({ id }: { id: string }) {
  const { rateOf } = useApp();
  const [project, setProject] = useState<TopsiteProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cur, setCur] = useState<CurrencyCode | null>(null);
  const [depth, setDepth] = useState<"3" | "4">("3");

  useEffect(() => {
    api
      .project(id)
      .then((r) => {
        if (r.project.kind !== "topsite") throw new Error("A apresentação está disponível para orçamentos no modelo da empresa.");
        setProject(r.project);
        setCur(r.project.currency.display);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const calc = useMemo(() => (project ? computeBudget(project) : null), [project]);
  const ins = useMemo(() => (project && calc ? computeInsights(project, calc) : null), [project, calc]);

  if (error) return <div className="page"><div className="page-inner"><div className="banner bad">{error}</div></div></div>;
  if (!project || !calc || !ins || !cur) return <div className="page"><div className="page-inner muted">Preparando apresentação…</div></div>;

  const rate = cur === "BRL" ? 1 : cur === project.currency.display ? project.currency.rate : rateOf(cur) || 1;
  const m = (v: number, opts?: { compact?: boolean }) => money(fromBRL(v, rate), cur, opts);
  const area = project.info.area ?? 0;
  const level2 = project.roots.flatMap((r) => r.children ?? []);
  const discRows = ins.disciplines.map((d) => ({ id: d.id, label: titleCase(d.name), value: d.sale, share: d.share }));
  // o que o cliente vê no detalhamento: preço de venda (encargos rateados proporcionalmente na linha de total)
  const factorTotal = calc.sale ? calc.total / calc.sale : 1;

  return (
    <div className="page present">
      <div className="present-bar no-print">
        <div className="inner">
          <button className="btn ghost sm" onClick={() => go(`/p/${project.id}`)}>
            <ArrowLeft size={15} /> Voltar ao orçamento
          </button>
          <div className="grow" />
          <span className="small muted">Detalhe</span>
          <Segmented
            value={depth}
            onChange={setDepth}
            options={[
              { value: "3", label: "Grupos" },
              { value: "4", label: "Itens" },
            ]}
          />
          <select className="select" style={{ width: 170, height: 32 }} value={cur} onChange={(e) => setCur(e.target.value as CurrencyCode)} aria-label="Moeda">
            {CURRENCY_CODES.map((c) => (
              <option key={c} value={c}>
                {c} — {CURRENCIES[c].name}
              </option>
            ))}
          </select>
          <button className="btn primary sm" onClick={() => window.print()}>
            <Printer size={14} /> Imprimir / PDF
          </button>
        </div>
      </div>

      <article className="sheetdoc">
        <header className="cover">
          <div>
            <div className="eyebrow">Proposta orçamentária · {project.info.revision}</div>
            <h1 className="cover-title">{project.info.name}</h1>
            <div className="cover-meta">
              {project.info.client && (
                <span>
                  Cliente <b>{project.info.client}</b>
                </span>
              )}
              {project.info.location && (
                <span>
                  Local <b>{project.info.location}</b>
                </span>
              )}
              <span>
                Data <b>{dateBR(project.info.date)}</b>
              </span>
              {area > 0 && (
                <span>
                  Área <b>{num(area)} m²</b>
                </span>
              )}
            </div>
          </div>
          <div className="company">
            <b>{project.info.company}</b>
            <div>Orçamento de obra</div>
            <div>Valores em {CURRENCIES[cur].name.toLowerCase()}</div>
          </div>
        </header>

        <section className="hero">
          <div>
            <div className="hero-k">Investimento total</div>
            <div className="hero-v">{m(calc.total)}</div>
            <div className="hero-alt">
              {cur !== "BRL" ? (
                <>
                  Equivalente a {money(calc.total)} · {rateLabel(cur, rate)}
                </>
              ) : (
                <>Inclui administração e impostos</>
              )}
            </div>
          </div>
          <div className="hero-tiles">
            <div>
              <div className="k">{area ? "Valor por m²" : "Serviços"}</div>
              <div className="v">{area ? m(calc.total / area) : m(calc.sale)}</div>
            </div>
            <div>
              <div className="k">Disciplinas</div>
              <div className="v">{level2.length}</div>
            </div>
            <div>
              <div className="k">Itens orçados</div>
              <div className="v">{calc.leafCount}</div>
            </div>
            <div>
              <div className="k">Maior disciplina</div>
              <div className="v" style={{ fontSize: 15, marginTop: 5 }}>
                {ins.disciplines[0] ? `${titleCase(ins.disciplines[0].name)} · ${pct(ins.disciplines[0].share, 0)}` : "—"}
              </div>
            </div>
          </div>
        </section>

        <section className="psec">
          <h2>Distribuição por disciplina</h2>
          <div className="sub">Valor dos serviços por disciplina, antes de administração e impostos</div>
          <BarList rows={discRows} format={(v) => m(v)} labelWidth={210} />
        </section>

        <section className="psec" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 36 }}>
          <div>
            <h2>Composição do investimento</h2>
            <div className="sub">Serviços, administração e impostos</div>
            <StackBar
              format={(v) => m(v, { compact: true })}
              parts={[
                { label: "Serviços", value: calc.sale, color: "var(--series-1)" },
                { label: project.params.adminLabel, value: calc.admin, color: "var(--series-2)" },
                { label: "Impostos", value: calc.tax, color: "var(--series-3)" },
              ]}
            />
          </div>
          <div>
            <h2>Material e mão de obra</h2>
            <div className="sub">Participação no valor dos serviços</div>
            <StackBar
              format={(v) => m(v, { compact: true })}
              parts={[
                { label: "Material", value: calc.materialSale, color: "var(--series-1)" },
                { label: "Mão de obra", value: calc.laborSale, color: "var(--series-2)" },
              ]}
            />
          </div>
        </section>

        <section className="psec">
          <h2>Detalhamento</h2>
          <div className="sub">Valores de serviço por {depth === "3" ? "disciplina e grupo" : "disciplina, grupo e item"}</div>
          <table className="detail">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Item</th>
                <th>Descrição</th>
                {depth === "4" && <th className="r">Qtd</th>}
                <th className="r" style={{ width: 150 }}>Valor</th>
                <th className="r" style={{ width: 140 }}>%</th>
              </tr>
            </thead>
            <tbody>
              {level2.map((d) => (
                <DetailRows key={d.id} node={d} calc={calc} m={m} depth={Number(depth)} />
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>Subtotal de serviços</td>
                {depth === "4" && <td />}
                <td className="r">{m(calc.sale)}</td>
                <td className="r">100%</td>
              </tr>
              <tr>
                <td />
                <td style={{ fontWeight: 500, borderTop: 0 }}>{project.params.adminLabel} ({pct(project.params.admin, 1)})</td>
                {depth === "4" && <td style={{ borderTop: 0 }} />}
                <td className="r" style={{ fontWeight: 500, borderTop: 0 }}>{m(calc.admin)}</td>
                <td style={{ borderTop: 0 }} />
              </tr>
              <tr>
                <td />
                <td style={{ fontWeight: 500, borderTop: 0 }}>Impostos ({pct(project.params.tax, 2)})</td>
                {depth === "4" && <td style={{ borderTop: 0 }} />}
                <td className="r" style={{ fontWeight: 500, borderTop: 0 }}>{m(calc.tax)}</td>
                <td style={{ borderTop: 0 }} />
              </tr>
              <tr>
                <td />
                <td style={{ fontSize: 15 }}>Investimento total</td>
                {depth === "4" && <td />}
                <td className="r" style={{ fontSize: 15 }}>{m(calc.total)}</td>
                <td className="r muted" style={{ fontWeight: 500 }}>× {num(factorTotal, 3)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        {(ins.inclusions.length > 0 || ins.exclusions.length > 0 || project.info.notes) && (
          <section className="psec">
            <h2>Premissas e exclusões</h2>
            <div className="sub">Extraídas dos comentários de cada item</div>
            <div className="notes">
              <div>
                <div className="h3" style={{ marginBottom: 6 }}>Considerado</div>
                {ins.inclusions.length ? (
                  <ul>
                    {ins.inclusions.slice(0, 14).map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="small muted">—</div>
                )}
              </div>
              <div>
                <div className="h3" style={{ marginBottom: 6 }}>Não considerado</div>
                {ins.exclusions.length ? (
                  <ul>
                    {ins.exclusions.slice(0, 14).map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="small muted">—</div>
                )}
              </div>
            </div>
            {project.info.notes && (
              <div style={{ marginTop: 18 }}>
                <div className="h3" style={{ marginBottom: 6 }}>Observações</div>
                <div className="small ink2" style={{ whiteSpace: "pre-wrap" }}>{project.info.notes}</div>
              </div>
            )}
          </section>
        )}

        <footer className="pfoot">
          <span>{project.info.company} · {project.info.name}</span>
          <span>
            {cur !== "BRL" ? `Conversão: ${rateLabel(cur, rate)} · ` : ""}Emitido em {dateBR(new Date().toISOString())}
          </span>
        </footer>
      </article>
    </div>
  );
}

function DetailRows({ node, calc, m, depth }: { node: BudgetNode; calc: ReturnType<typeof computeBudget>; m: (v: number) => string; depth: number }) {
  const c = calc.byId.get(node.id)!;
  const share = calc.sale ? c.sale / calc.sale : 0;
  if (node.level === 4 && depth < 4) return null;
  return (
    <Fragment>
      <tr className={`d${node.level}`}>
        <td className="num muted">{c.code}</td>
        <td>{node.level === 2 ? titleCase(node.description) : node.description}</td>
        {depth === 4 && <td className="r num">{node.level === 4 && node.qty ? `${num(node.qty)} ${node.unit ?? ""}` : ""}</td>}
        <td className="r num">{m(c.sale)}</td>
        <td className="r num">
          {node.level === 2 && (
            <span className="inbar">
              <i style={{ width: `${share * 100}%` }} />
            </span>
          )}
          {pct(share, 1)}
        </td>
      </tr>
      {node.level < depth && (node.children ?? []).map((ch) => <DetailRows key={ch.id} node={ch} calc={calc} m={m} depth={depth} />)}
    </Fragment>
  );
}

function titleCase(s: string) {
  if (s !== s.toUpperCase()) return s;
  const small = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "em", "para"]);
  return s
    .toLowerCase()
    .split(/(\s+|\+)/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
}
