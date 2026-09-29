// Indicadores determinísticos do orçamento (não dependem de IA).
import type { BudgetCalc } from "../../shared/calc";
import { money, num, pct } from "../../shared/format";
import type { BudgetNode, TopsiteProject } from "../../shared/types";

export interface Alert {
  tone: "bad" | "warn" | "info" | "good";
  title: string;
  detail?: string;
  itemIds?: string[];
}

export interface Insights {
  disciplines: { id: string; name: string; cost: number; sale: number; material: number; labor: number; share: number; items: number }[];
  topItems: { id: string; name: string; path: string; cost: number; share: number; cumulative: number }[];
  pareto: { count: number; total: number; share: number };
  alerts: Alert[];
  inclusions: string[];
  exclusions: string[];
  margin: number;
  markup: number;
  laborShare: number;
}

const EXCL = /(n[aã]o\s+(foi\s+)?(considerad|inclus|previst|contemplad)|exclu[íi]d|excluso|por conta d[oa] cliente|fornecid[oa] pel[oa] cliente)/i;
const INCL = /(considerad|inclus[oa]|incluíd|contempla)/i;

export function computeInsights(p: TopsiteProject, calc: BudgetCalc): Insights {
  const level2 = p.roots.flatMap((r) => r.children ?? []);
  const disciplines = level2
    .map((d) => {
      const c = calc.byId.get(d.id)!;
      return {
        id: d.id,
        name: d.description,
        cost: c.cost,
        sale: c.sale,
        material: c.materialSale,
        labor: c.laborSale,
        share: calc.sale ? c.sale / calc.sale : 0,
        items: c.leafCount,
      };
    })
    .sort((a, b) => b.sale - a.sale);

  const leaves = calc.rows.filter((r) => r.node.level === 4);
  const sorted = [...leaves].sort((a, b) => b.calc.cost - a.calc.cost);
  let acc = 0;
  const topItems = sorted.map((r) => {
    acc += r.calc.cost;
    return {
      id: r.node.id,
      name: r.node.description,
      path: r.calc.path.join(" › "),
      cost: r.calc.cost,
      share: calc.cost ? r.calc.cost / calc.cost : 0,
      cumulative: calc.cost ? acc / calc.cost : 0,
    };
  });
  const paretoCount = Math.max(1, topItems.findIndex((t) => t.cumulative >= 0.8) + 1);

  const alerts: Alert[] = [];
  const noPrice = leaves.filter((r) => !r.node.material && !r.node.labor && !/inclus|incluído|incluso/i.test(`${r.node.comments ?? ""} ${r.node.supplier ?? ""}`));
  if (noPrice.length)
    alerts.push({
      tone: "bad",
      title: `${noPrice.length} ${noPrice.length === 1 ? "item sem preço" : "itens sem preço"}`,
      detail: noPrice.slice(0, 4).map((r) => r.node.description).join(" · ") + (noPrice.length > 4 ? " …" : ""),
      itemIds: noPrice.map((r) => r.node.id),
    });
  const noQty = leaves.filter((r) => !r.node.qty);
  if (noQty.length)
    alerts.push({ tone: "bad", title: `${noQty.length} sem quantidade`, detail: noQty.slice(0, 4).map((r) => r.node.description).join(" · "), itemIds: noQty.map((r) => r.node.id) });
  const noUnit = leaves.filter((r) => !r.node.unit?.trim());
  if (noUnit.length) alerts.push({ tone: "warn", title: `${noUnit.length} sem unidade`, itemIds: noUnit.map((r) => r.node.id) });
  const emptyGroups = calc.rows.filter((r) => r.node.level === 3 && !(r.node.children ?? []).length);
  if (emptyGroups.length) alerts.push({ tone: "warn", title: `${emptyGroups.length} ${emptyGroups.length === 1 ? "grupo vazio" : "grupos vazios"}`, detail: emptyGroups.map((r) => r.node.description).join(" · ") });
  const top = disciplines[0];
  if (top && top.share > 0.5)
    alerts.push({ tone: "info", title: `${top.name} concentra ${pct(top.share, 0)} do valor`, detail: "Vale uma segunda cotação ou negociação específica para esta disciplina." });
  const withMarkup = leaves.filter((r) => r.node.markup);
  if (withMarkup.length)
    alerts.push({
      tone: "info",
      title: `${withMarkup.length} ${withMarkup.length === 1 ? "item com índice individual" : "itens com índice individual"} de venda`,
      detail: withMarkup.map((r) => `${r.node.description} (+${pct(r.node.markup!, 0)})`).join(" · "),
      itemIds: withMarkup.map((r) => r.node.id),
    });
  const seen = new Map<string, BudgetNode>();
  const dups: string[] = [];
  for (const r of leaves) {
    const k = r.node.description.trim().toLowerCase();
    if (seen.has(k)) dups.push(r.node.id);
    else seen.set(k, r.node);
  }
  if (dups.length) alerts.push({ tone: "warn", title: `${dups.length} ${dups.length === 1 ? "descrição repetida" : "descrições repetidas"}`, detail: "Confira se não há itens lançados em dobro.", itemIds: dups });
  const foreign = leaves.filter((r) => r.node.foreign);
  if (foreign.length)
    alerts.push({
      tone: "info",
      title: `${foreign.length} ${foreign.length === 1 ? "preço convertido" : "preços convertidos"} de moeda estrangeira`,
      detail: foreign.map((r) => `${r.node.description} (${r.node.foreign!.currency} @ ${num(r.node.foreign!.rate, 4)})`).join(" · "),
      itemIds: foreign.map((r) => r.node.id),
    });
  if (!alerts.some((a) => a.tone === "bad")) alerts.push({ tone: "good", title: "Todos os itens têm preço e quantidade" });

  const inclusions: string[] = [];
  const exclusions: string[] = [];
  for (const r of leaves) {
    const text = [r.node.comments, r.node.supplier].filter(Boolean).join("\n");
    for (const raw of text.split(/\n|(?<=\.)\s+/)) {
      const line = raw.trim().replace(/\s+/g, " ");
      if (line.length < 6) continue;
      const entry = `${r.node.description}: ${line}`;
      if (EXCL.test(line)) exclusions.push(entry);
      else if (INCL.test(line)) inclusions.push(entry);
    }
  }

  return {
    disciplines,
    topItems: topItems.slice(0, 12),
    pareto: { count: paretoCount, total: leaves.length, share: leaves.length ? paretoCount / leaves.length : 0 },
    alerts,
    inclusions,
    exclusions,
    margin: calc.sale - calc.cost,
    markup: calc.cost ? calc.sale / calc.cost - 1 : 0,
    laborShare: calc.sale ? calc.laborSale / calc.sale : 0,
  };
}

/** Texto compacto dos indicadores para a análise por IA. */
export function metricsText(p: TopsiteProject, calc: BudgetCalc, ins: Insights) {
  const lines = [
    `Custo direto ${money(calc.cost)} · venda ${money(calc.sale)} · margem bruta ${money(ins.margin)} (${pct(ins.markup)} sobre o custo)`,
    `Mão de obra = ${pct(ins.laborShare)} da venda; material = ${pct(1 - ins.laborShare)}`,
    p.info.area ? `Área ${num(p.info.area)} m² → ${money(calc.total / p.info.area)}/m² (total da proposta)` : "Área não informada",
    `Pareto: ${ins.pareto.count} de ${ins.pareto.total} itens somam 80% do custo`,
    `Por disciplina: ${ins.disciplines.map((d) => `${d.name} ${pct(d.share)}`).join(" · ")}`,
    `Alertas: ${ins.alerts.map((a) => a.title).join(" · ")}`,
  ];
  return lines.join("\n");
}
