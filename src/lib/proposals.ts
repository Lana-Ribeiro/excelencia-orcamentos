import { findNode, insertChild, removeNode, uid, updateNode } from "../../shared/calc";
import { money, num, pct } from "../../shared/format";
import type { BudgetNode, ClientProject, ClientTemplate, CurrencyCode, Proposal, ProposedItem, TopsiteProject } from "../../shared/types";

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function priceFields(item: Partial<ProposedItem>, rateOf: (c: CurrencyCode) => number): Partial<BudgetNode> {
  const out: Partial<BudgetNode> = {};
  const cur = item.currency && item.currency !== "BRL" ? item.currency : null;
  const rate = cur ? rateOf(cur) : 1;
  const conv = (v: number | null | undefined) => (typeof v === "number" ? Math.round(v * rate * 100) / 100 : v);
  if (item.material !== undefined) {
    out.material = conv(item.material);
    out.materialExpr = undefined;
  }
  if (item.labor !== undefined) {
    out.labor = conv(item.labor);
    out.laborExpr = undefined;
  }
  if (cur && rate) out.foreign = { currency: cur, rate, material: item.material ?? null, labor: item.labor ?? null, at: new Date().toISOString() };
  return out;
}

function toNode(item: ProposedItem, rateOf: (c: CurrencyCode) => number): BudgetNode {
  return {
    id: uid(),
    level: 4,
    description: item.description,
    unit: item.unit,
    qty: item.qty ?? null,
    supplier: item.supplier,
    comments: item.comments,
    specs: item.specs,
    material: null,
    labor: null,
    ...priceFields(item, rateOf),
  };
}

export function applyTopsiteProposal(p: TopsiteProject, prop: Proposal, rateOf: (c: CurrencyCode) => number): TopsiteProject {
  switch (prop.type) {
    case "add_items": {
      let roots = p.roots.length ? p.roots : [{ id: uid(), level: 1 as const, description: p.info.name.toUpperCase(), children: [] }];
      const root = roots[0];
      let disc = (root.children ?? []).find((d) => norm(d.description) === norm(prop.discipline));
      if (!disc) {
        disc = { id: uid(), level: 2, description: prop.discipline.toUpperCase(), children: [] };
        roots = insertChild(roots, root.id, disc);
      }
      const discNow = findNode(roots, disc.id)!;
      let group = (discNow.children ?? []).find((g) => norm(g.description) === norm(prop.group));
      if (!group) {
        group = { id: uid(), level: 3, description: prop.group, children: [] };
        roots = insertChild(roots, disc.id, group);
      }
      for (const item of prop.items) roots = insertChild(roots, group.id, toNode(item, rateOf));
      return { ...p, roots };
    }
    case "update_item": {
      const node = findNode(p.roots, prop.itemId);
      if (!node) return p;
      const c = prop.changes;
      const patch: Partial<BudgetNode> = { ...priceFields(c, rateOf) };
      if (c.description !== undefined) patch.description = c.description;
      if (c.unit !== undefined) patch.unit = c.unit;
      if (c.qty !== undefined) {
        patch.qty = c.qty;
        patch.qtyExpr = undefined;
      }
      if (c.supplier !== undefined) patch.supplier = c.supplier;
      if (c.comments !== undefined) patch.comments = c.comments;
      if (c.specs) {
        const merged = [...(node.specs ?? [])];
        for (const s of c.specs) {
          const i = merged.findIndex((m) => norm(m.key) === norm(s.key));
          if (i >= 0) merged[i] = s;
          else merged.push(s);
        }
        patch.specs = merged;
      }
      return { ...p, roots: updateNode(p.roots, prop.itemId, patch) };
    }
    case "remove_item":
      return { ...p, roots: removeNode(p.roots, prop.itemId) };
    case "set_params": {
      const c = prop.changes;
      const params = { ...p.params };
      if (c.bdi !== undefined) params.bdi = c.bdi;
      if (c.admin !== undefined) params.admin = c.admin;
      if (c.tax !== undefined) params.tax = c.tax;
      let currency = p.currency;
      if (c.display) {
        const rate = rateOf(c.display);
        currency = c.display === "BRL" ? { ...currency, display: "BRL" } : { ...currency, display: c.display, foreign: c.display, rate: rate || currency.rate, mode: "live", rateAt: new Date().toISOString() };
      }
      return { ...p, params, currency };
    }
    default:
      return p;
  }
}

export function applyClientProposal(p: ClientProject, t: ClientTemplate, prop: Proposal, rateOf: (c: CurrencyCode) => number): ClientProject {
  const values = { ...p.values };
  const foreign = { ...(p.foreign ?? {}) };
  if (prop.type === "fill_client_row") {
    const col = t.columns;
    const c = prop.changes;
    const set = (key?: string, v?: string | number) => {
      if (key && v !== undefined && v !== null && v !== "") values[`${key}${prop.row}`] = v;
    };
    set(col.qty, c.qty);
    set(col.unit, c.unit);
    set(col.applicable, c.applicable);
    set(col.obs, c.obs);
    set(col.desc, c.desc);
    if (c.unitPrice !== undefined && col.unitPrice) {
      const cur = c.currency && c.currency !== "BRL" ? c.currency : null;
      const rate = cur ? rateOf(cur) : 1;
      values[`${col.unitPrice}${prop.row}`] = Math.round(c.unitPrice * rate * 100) / 100;
      if (cur) foreign[`${col.unitPrice}${prop.row}`] = { currency: cur, rate, material: c.unitPrice, at: new Date().toISOString() };
      else delete foreign[`${col.unitPrice}${prop.row}`];
    }
  } else if (prop.type === "fill_client_cell") {
    values[prop.cell] = prop.value;
  }
  return { ...p, values, foreign };
}

// ---------- descrição legível das propostas ----------
export interface ProposalView {
  title: string;
  lines: [string, string][];
}

export function describeProposal(prop: Proposal, ctx: { find?: (id: string) => BudgetNode | null; template?: ClientTemplate }): ProposalView {
  const priceLine = (it: Partial<ProposedItem>) => {
    const cur = it.currency ?? "BRL";
    const parts: string[] = [];
    if (typeof it.material === "number") parts.push(`mat ${money(it.material, cur)}`);
    if (typeof it.labor === "number") parts.push(`m.o. ${money(it.labor, cur)}`);
    return parts.join(" + ");
  };
  switch (prop.type) {
    case "add_items":
      return {
        title: `Adicionar ${prop.items.length} ${prop.items.length === 1 ? "item" : "itens"} em ${prop.discipline} › ${prop.group}`,
        lines: prop.items.map((it) => [
          `${it.description}${typeof it.qty === "number" ? ` · ${num(it.qty)} ${it.unit ?? ""}` : ""}`,
          priceLine(it) || "sem preço",
        ]),
      };
    case "update_item": {
      const node = ctx.find?.(prop.itemId);
      const c = prop.changes;
      const lines: [string, string][] = [];
      if (c.description !== undefined) lines.push(["Descrição", c.description]);
      if (c.unit !== undefined) lines.push(["Unidade", c.unit]);
      if (c.qty !== undefined) lines.push(["Quantidade", num(c.qty ?? 0)]);
      if (c.material !== undefined || c.labor !== undefined) lines.push(["Preço", priceLine(c)]);
      if (c.supplier !== undefined) lines.push(["Fornecedor", c.supplier]);
      if (c.comments !== undefined) lines.push(["Comentários", c.comments]);
      c.specs?.forEach((s) => lines.push([s.key, s.value]));
      return { title: `Alterar “${node?.description ?? "item"}”`, lines };
    }
    case "remove_item": {
      const node = ctx.find?.(prop.itemId);
      return { title: `Remover “${node?.description ?? "item"}”`, lines: prop.note ? [["Motivo", prop.note]] : [] };
    }
    case "set_params": {
      const c = prop.changes;
      const lines: [string, string][] = [];
      if (c.bdi !== undefined) lines.push(["BDI", pct(c.bdi)]);
      if (c.admin !== undefined) lines.push(["Administração", pct(c.admin)]);
      if (c.tax !== undefined) lines.push(["Imposto", pct(c.tax, 2)]);
      if (c.display) lines.push(["Moeda de apresentação", c.display]);
      return { title: "Ajustar parâmetros", lines };
    }
    case "fill_client_row": {
      const item = ctx.template?.sections.flatMap((s) => s.items).find((i) => i.row === prop.row);
      const c = prop.changes;
      const lines: [string, string][] = [];
      if (c.desc) lines.push(["Descrição", c.desc]);
      if (c.qty !== undefined) lines.push(["Quantidade", `${num(c.qty)} ${c.unit ?? ""}`]);
      else if (c.unit) lines.push(["Unidade", c.unit]);
      if (c.unitPrice !== undefined) lines.push(["Preço unitário", money(c.unitPrice, c.currency ?? "BRL")]);
      if (c.applicable) lines.push(["Aplicável", c.applicable]);
      if (c.obs) lines.push(["Observações", c.obs]);
      return { title: `Linha ${prop.row} · ${item?.code ?? ""} ${item?.desc || c.desc || ""}`.trim(), lines };
    }
    case "fill_client_cell": {
      const f = [...(ctx.template?.fields ?? []), ...(ctx.template?.params ?? [])].find((x) => x.cell === prop.cell);
      return { title: `Preencher ${f?.label ?? prop.cell}`, lines: [[prop.cell, String(prop.value)]] };
    }
  }
}
