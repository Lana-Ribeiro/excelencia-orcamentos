// Resumos de orçamentos (cartões da página inicial) — usados pelo servidor local e
// pela versão que roda só no navegador.

import { computeBudget } from "./calc";
import { SheetEvaluator, type EvalCell } from "./formula";
import type { AnyProject, ClientProject, ClientTemplate, ProjectSummary } from "./types";

export function clientTotal(template: ClientTemplate, cells: Record<string, EvalCell>, p: ClientProject) {
  const overrides: Record<string, string | number | null> = { ...p.values };
  const { qty, unitPrice } = template.columns;
  for (const ref of template.staticTotals ?? []) {
    const row = ref.replace(/^[A-Z]+/, "");
    const q = overrides[`${qty}${row}`] ?? cells[`${qty}${row}`]?.v;
    const u = overrides[`${unitPrice}${row}`] ?? cells[`${unitPrice}${row}`]?.v;
    if (typeof q === "number" && typeof u === "number") overrides[ref] = q * u;
  }
  const ev = new SheetEvaluator(cells, overrides);
  const finalOut = template.outputs.find((o) => /valor final|total final|total geral/i.test(o.label));
  const ref = finalOut?.cell ?? template.grandTotalCell;
  return ref ? ev.numeric(ref) ?? 0 : 0;
}

export function summarizeProject(p: AnyProject, tpl?: { template: ClientTemplate; cells: Record<string, EvalCell> } | null): ProjectSummary {
  if (p.kind === "topsite") {
    const calc = computeBudget(p);
    const level2 = p.roots.flatMap((r) => r.children ?? []);
    return {
      id: p.id,
      kind: "topsite",
      name: p.info.name,
      client: p.info.client,
      company: p.info.company,
      revision: p.info.revision,
      total: calc.total,
      cost: calc.cost,
      sale: calc.sale,
      items: calc.leafCount,
      display: p.currency.display,
      rate: p.currency.rate,
      topGroups: level2
        .map((g) => ({ name: g.description, value: calc.byId.get(g.id)?.sale ?? 0 }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),
      updatedAt: p.updatedAt,
    };
  }
  let total = 0;
  let items = 0;
  let totalItems = 0;
  if (tpl) {
    const { template, cells } = tpl;
    total = clientTotal(template, cells, p);
    totalItems = template.sections.reduce((s, sec) => s + sec.items.length, 0);
    items = template.sections.reduce(
      (s, sec) => s + sec.items.filter((it) => typeof (p.values[`${template.columns.unitPrice}${it.row}`] ?? null) === "number").length,
      0,
    );
  }
  return {
    id: p.id,
    kind: "client",
    name: p.info.name,
    client: p.info.client,
    revision: p.info.revision,
    total,
    items,
    totalItems,
    display: p.currency.display,
    rate: p.currency.rate,
    templateName: tpl?.template.name,
    updatedAt: p.updatedAt,
  };
}
