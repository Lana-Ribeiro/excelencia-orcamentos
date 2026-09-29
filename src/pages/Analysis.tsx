import { useMemo, useRef, useState } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, Sparkles, Square } from "lucide-react";
import { BarList, StackBar } from "../components/charts";
import { Markdown, Segmented } from "../components/ui";
import { ESTATICO, streamPost } from "../lib/api";
import { computeInsights, metricsText } from "../lib/insights";
import { useApp } from "../lib/app";
import { fromBRL, type BudgetCalc } from "../../shared/calc";
import { money, pct } from "../../shared/format";
import type { TopsiteProject } from "../../shared/types";

export function Analysis({ project, calc, onOpenItem }: { project: TopsiteProject; calc: BudgetCalc; onOpenItem: (id: string) => void }) {
  const ins = useMemo(() => computeInsights(project, calc), [project, calc]);
  const [basis, setBasis] = useState<"sale" | "cost">("sale");
  const { ai } = useApp();
  const cur = project.currency.display;
  const rate = cur === "BRL" ? 1 : project.currency.rate;
  const m = (v: number, compact = false) => money(fromBRL(v, rate), cur, { compact });

  const [aiText, setAiText] = useState(() => localStorage.getItem(`analise:${project.id}`) ?? "");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const runAI = async () => {
    setAiText("");
    setAiErr(null);
    setAiBusy(true);
    ctrl.current = new AbortController();
    let acc = "";
    await streamPost(
      "/api/ai/insights",
      { project, metrics: metricsText(project, calc, ins) },
      {
        onText: (d) => {
          acc += d;
          setAiText(acc);
        },
        onError: setAiErr,
      },
      ctrl.current.signal,
    );
    if (acc) localStorage.setItem(`analise:${project.id}`, acc);
    setAiBusy(false);
  };

  const discRows = ins.disciplines.map((d) => ({
    id: d.id,
    label: d.name,
    value: basis === "sale" ? d.sale : d.cost,
    share: basis === "sale" ? d.share : calc.cost ? d.cost / calc.cost : 0,
    detail: `${d.items} ${d.items === 1 ? "item" : "itens"}`,
  }));

  const Icon = { bad: AlertOctagon, warn: AlertTriangle, info: Info, good: CheckCircle2 };

  return (
    <div className="dash">
      <div className="tiles">
        <div className="tile">
          <span className="k">Total da proposta</span>
          <span className="v">{m(calc.total)}</span>
          <span className="d">{project.info.area ? `${m(calc.total / project.info.area)} por m²` : "informe a área para ver o valor por m²"}</span>
        </div>
        <div className="tile">
          <span className="k">Custo direto</span>
          <span className="v">{m(calc.cost)}</span>
          <span className="d">{calc.leafCount} itens · {ins.disciplines.length} disciplinas</span>
        </div>
        <div className="tile">
          <span className="k">Margem bruta (venda − custo)</span>
          <span className="v">{m(ins.margin)}</span>
          <span className="d">{pct(ins.markup)} sobre o custo · BDI {pct(project.params.bdi, 1)}</span>
        </div>
        <div className="tile">
          <span className="k">Administração + impostos</span>
          <span className="v">{m(calc.admin + calc.tax)}</span>
          <span className="d">{pct(calc.total ? (calc.admin + calc.tax) / calc.total : 0)} do total</span>
        </div>
      </div>

      <div className="two">
        <div className="chart-card">
          <div className="row between" style={{ alignItems: "flex-start" }}>
            <div>
              <h3>Onde está o dinheiro</h3>
              <div className="sub">{basis === "sale" ? "Preço de venda" : "Custo direto"} por disciplina, em {cur}</div>
            </div>
            <Segmented
              value={basis}
              onChange={setBasis}
              options={[
                { value: "sale", label: "Venda" },
                { value: "cost", label: "Custo" },
              ]}
            />
          </div>
          {discRows.length ? <BarList rows={discRows} format={(v) => m(v)} /> : <div className="muted small">Sem disciplinas ainda.</div>}
        </div>
        <div className="col" style={{ gap: 20 }}>
          <div className="chart-card">
            <h3>Composição do total</h3>
            <div className="sub">Do preço de venda até o total da proposta</div>
            <StackBar
              format={(v) => m(v, true)}
              parts={[
                { label: "Serviços (venda)", value: calc.sale, color: "var(--series-1)" },
                { label: project.params.adminLabel, value: calc.admin, color: "var(--series-2)" },
                { label: "Impostos", value: calc.tax, color: "var(--series-3)" },
              ]}
            />
          </div>
          <div className="chart-card">
            <h3>Material × mão de obra</h3>
            <div className="sub">Sobre o preço de venda</div>
            <StackBar
              format={(v) => m(v, true)}
              parts={[
                { label: "Material", value: calc.materialSale, color: "var(--series-1)" },
                { label: "Mão de obra", value: calc.laborSale, color: "var(--series-2)" },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="two">
        <div className="chart-card">
          <h3>Concentração (Pareto)</h3>
          <div className="sub">
            <b style={{ color: "var(--ink)" }}>{ins.pareto.count}</b> de {ins.pareto.total} itens ({pct(ins.pareto.share, 0)}) somam 80% do custo — é onde negociar faz diferença.
          </div>
          <table className="pareto">
            <tbody>
              {ins.topItems.map((t, i) => (
                <tr key={t.id} style={{ cursor: "pointer", opacity: i >= ins.pareto.count ? 0.55 : 1 }} onClick={() => onOpenItem(t.id)}>
                  <td style={{ width: 22 }} className="muted">{i + 1}</td>
                  <td>
                    <div style={{ fontWeight: 540 }}>{t.name}</div>
                    <div className="xs muted">{t.path}</div>
                  </td>
                  <td>
                    <div className="inbar"><i style={{ width: `${(t.cost / (ins.topItems[0]?.cost || 1)) * 100}%` }} /></div>
                  </td>
                  <td className="r">{m(t.cost)}</td>
                  <td className="r muted" style={{ width: 64 }}>{pct(t.cumulative, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="xs muted" style={{ marginTop: 6 }}>Última coluna: participação acumulada no custo.</div>
        </div>
        <div className="chart-card">
          <h3>Pontos de atenção</h3>
          <div className="sub">Verificações automáticas da planilha</div>
          <div className="alerts">
            {ins.alerts.map((a, i) => {
              const I = Icon[a.tone];
              return (
                <div key={i} className={`alert ${a.tone}`}>
                  <I size={16} className="ic" />
                  <div className="grow">
                    <div className="t">{a.title}</div>
                    {a.detail && <div className="d">{a.detail}</div>}
                    {a.itemIds?.length === 1 && (
                      <button className="link" onClick={() => onOpenItem(a.itemIds![0])}>Abrir item</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="chart-card ai-card">
        <div className="row between" style={{ marginBottom: 12 }}>
          <div>
            <h3 className="row" style={{ gap: 7 }}>
              <Sparkles size={15} /> Análise do orçamento
            </h3>
            <div className="sub" style={{ marginBottom: 0 }}>Leitura executiva, riscos de escopo, oportunidades de negociação e perguntas a fazer.</div>
          </div>
          {aiBusy ? (
            <button className="btn sm" onClick={() => ctrl.current?.abort()}>
              <Square size={12} /> Parar
            </button>
          ) : (
            <button className="btn primary sm" onClick={runAI} disabled={!calc.leafCount || ESTATICO}>
              <Sparkles size={14} /> {aiText ? "Gerar novamente" : "Gerar análise com IA"}
            </button>
          )}
        </div>
        {aiErr && <div className="banner bad">{aiErr}</div>}
        {aiText ? (
          <div className="md" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            <Markdown text={aiText} />
          </div>
        ) : aiBusy ? (
          <span className="thinking"><i /><i /><i /> analisando o orçamento</span>
        ) : (
          <div className="small muted">
            {ESTATICO ? "A análise por IA não está ativa na versão online de demonstração. Os indicadores acima funcionam normalmente." : ai?.configured ? "Clique em “Gerar análise com IA” para uma leitura crítica deste orçamento." : "Configure a chave da API da Anthropic para ativar a análise por IA. Os indicadores acima funcionam sem ela."}
          </div>
        )}
      </div>
    </div>
  );
}
