// Motor de cálculo — replica as regras das colunas da planilha modelo.
//
// Planilha Custo
//   K (unitário) = I + J
//   L (total)    = nível 4 → K × H ; nível 3 → soma dos filhos nível 4 ; níveis 1/2 → soma dos descendentes
//   M            = L ÷ AS2 (índice da moeda estrangeira)
// Planilha Venda
//   I, J, K      = valor de custo × (1 + índice global AK1) × (1 + índice individual AK da linha)
// Planilha Resumo
//   Administração = Venda × K163
//   Imposto       = (Venda + Adm) ÷ (1 − K164) − (Venda + Adm)
//   Valor total   = Venda + Adm + Imposto

import type { BudgetNode, BudgetParams, TopsiteProject } from "./types";

export interface NodeCalc {
  id: string;
  code: string;
  level: number;
  description: string;
  unitCost: number; // K custo
  cost: number; // L custo
  materialCost: number; // Σ I×H
  laborCost: number; // Σ J×H
  unitSale: number; // K venda
  sale: number; // L venda
  materialSale: number;
  laborSale: number;
  factor: number; // fator de venda aplicado (só nível 4)
  leafCount: number;
  path: string[]; // descrições dos ancestrais (nível 2 → nível 3)
}

export interface BudgetCalc {
  byId: Map<string, NodeCalc>;
  rows: { node: BudgetNode; calc: NodeCalc; parentId: string | null }[]; // ordem da planilha
  cost: number;
  sale: number;
  materialCost: number;
  laborCost: number;
  materialSale: number;
  laborSale: number;
  admin: number;
  tax: number;
  total: number;
  leafCount: number;
}

const n = (v: number | null | undefined) => (typeof v === "number" && isFinite(v) ? v : 0);

export function saleFactor(params: Pick<BudgetParams, "bdi">, node: Pick<BudgetNode, "markup">) {
  return (1 + n(params.bdi)) * (1 + n(node.markup));
}

export function computeBudget(project: Pick<TopsiteProject, "roots" | "params">): BudgetCalc {
  const byId = new Map<string, NodeCalc>();
  const rows: BudgetCalc["rows"] = [];

  const walk = (node: BudgetNode, code: string, path: string[], parentId: string | null): NodeCalc => {
    const base: NodeCalc = {
      id: node.id,
      code,
      level: node.level,
      description: node.description,
      unitCost: 0,
      cost: 0,
      materialCost: 0,
      laborCost: 0,
      unitSale: 0,
      sale: 0,
      materialSale: 0,
      laborSale: 0,
      factor: 1,
      leafCount: 0,
      path,
    };
    const row = { node, calc: base, parentId };
    rows.push(row);

    if (node.level === 4) {
      const qty = n(node.qty);
      const mat = n(node.material);
      const lab = n(node.labor);
      const f = saleFactor(project.params, node);
      base.factor = f;
      base.unitCost = mat + lab;
      base.cost = base.unitCost * qty;
      base.materialCost = mat * qty;
      base.laborCost = lab * qty;
      base.unitSale = base.unitCost * f;
      base.sale = base.unitSale * qty;
      base.materialSale = mat * f * qty;
      base.laborSale = lab * f * qty;
      base.leafCount = 1;
    } else {
      const kids = node.children ?? [];
      kids.forEach((child, i) => {
        const childPath = node.level >= 2 ? [...path, node.description] : path;
        const c = walk(child, `${code}.${i + 1}`, childPath, node.id);
        // Nível 3 soma apenas filhos nível 4 (SUMIFS com AG = nível + 1).
        if (node.level === 3 && child.level !== 4) return;
        base.cost += c.cost;
        base.materialCost += c.materialCost;
        base.laborCost += c.laborCost;
        base.sale += c.sale;
        base.materialSale += c.materialSale;
        base.laborSale += c.laborSale;
        base.leafCount += c.leafCount;
      });
    }
    byId.set(node.id, base);
    return base;
  };

  let cost = 0,
    sale = 0,
    materialCost = 0,
    laborCost = 0,
    materialSale = 0,
    laborSale = 0,
    leafCount = 0;
  project.roots.forEach((root, i) => {
    const c = walk(root, String(i + 1), [], null);
    cost += c.cost;
    sale += c.sale;
    materialCost += c.materialCost;
    laborCost += c.laborCost;
    materialSale += c.materialSale;
    laborSale += c.laborSale;
    leafCount += c.leafCount;
  });

  const admin = sale * n(project.params.admin);
  const taxRate = n(project.params.tax);
  const tax = taxRate < 1 ? (sale + admin) / (1 - taxRate) - (sale + admin) : 0;
  return {
    byId,
    rows,
    cost,
    sale,
    materialCost,
    laborCost,
    materialSale,
    laborSale,
    admin,
    tax,
    total: sale + admin + tax,
    leafCount,
  };
}

/** Converte BRL para a moeda de exibição. `rate` = BRL por 1 unidade da moeda. */
export function fromBRL(value: number, rate: number) {
  return rate > 0 ? value / rate : value;
}

// ---------- Árvore: utilidades imutáveis ----------

export function mapTree(nodes: BudgetNode[], fn: (n: BudgetNode) => BudgetNode): BudgetNode[] {
  return nodes.map((node) => {
    const mapped = fn(node);
    return mapped.children ? { ...mapped, children: mapTree(mapped.children, fn) } : mapped;
  });
}

export function findNode(nodes: BudgetNode[], id: string): BudgetNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = node.children ? findNode(node.children, id) : null;
    if (hit) return hit;
  }
  return null;
}

export function findParent(nodes: BudgetNode[], id: string, parent: BudgetNode | null = null): BudgetNode | null | undefined {
  for (const node of nodes) {
    if (node.id === id) return parent;
    if (node.children) {
      const hit = findParent(node.children, id, node);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

export function removeNode(nodes: BudgetNode[], id: string): BudgetNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => (node.children ? { ...node, children: removeNode(node.children, id) } : node));
}

export function updateNode(nodes: BudgetNode[], id: string, patch: Partial<BudgetNode>): BudgetNode[] {
  return nodes.map((node) => {
    if (node.id === id) return { ...node, ...patch };
    return node.children ? { ...node, children: updateNode(node.children, id, patch) } : node;
  });
}

export function insertChild(nodes: BudgetNode[], parentId: string, child: BudgetNode, index?: number): BudgetNode[] {
  return nodes.map((node) => {
    if (node.id === parentId) {
      const kids = [...(node.children ?? [])];
      kids.splice(index ?? kids.length, 0, child);
      return { ...node, children: kids };
    }
    return node.children ? { ...node, children: insertChild(node.children, parentId, child, index) } : node;
  });
}

export function moveNode(nodes: BudgetNode[], id: string, delta: -1 | 1): BudgetNode[] {
  const idx = nodes.findIndex((x) => x.id === id);
  if (idx >= 0) {
    const target = idx + delta;
    if (target < 0 || target >= nodes.length) return nodes;
    const copy = [...nodes];
    [copy[idx], copy[target]] = [copy[target], copy[idx]];
    return copy;
  }
  return nodes.map((node) => (node.children ? { ...node, children: moveNode(node.children, id, delta) } : node));
}

export function flatten(nodes: BudgetNode[]): BudgetNode[] {
  const out: BudgetNode[] = [];
  const rec = (list: BudgetNode[]) =>
    list.forEach((x) => {
      out.push(x);
      if (x.children) rec(x.children);
    });
  rec(nodes);
  return out;
}

export function uid(prefix = "n") {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

// ---------- Expressões numéricas (memória de cálculo) ----------

/**
 * Avalia expressões simples digitadas pelo usuário ("135,4*1,2", "90*30", "1.500,00").
 * Retorna o valor e a fórmula em formato Excel (ponto decimal) ou null se inválida.
 */
export function parseNumberInput(raw: string): { value: number; expr?: string } | null {
  let s = raw.trim().replace(/\s+/g, "");
  if (!s) return null;
  s = s.replace(/^=/, "").replace(/R\$/gi, "");
  const hasOperator = /[+\-*/x×()]/.test(s.replace(/^-/, ""));
  // normaliza números pt-BR: 1.234,56 → 1234.56
  s = s.replace(/\d[\d.,]*/g, (num) => normalizeNumber(num));
  s = s.replace(/[x×]/g, "*");
  if (!/^[\d+\-*/().]+$/.test(s)) return null;
  const value = evalArithmetic(s);
  if (value === null || !isFinite(value)) return null;
  return hasOperator ? { value, expr: s } : { value };
}

function normalizeNumber(num: string) {
  const hasComma = num.includes(",");
  const dots = (num.match(/\./g) || []).length;
  if (hasComma) return num.replace(/\./g, "").replace(",", ".");
  if (dots > 1) return num.replace(/\./g, "");
  // "1.500" com 3 casas após o ponto → milhar
  if (dots === 1 && /^\d{1,3}\.\d{3}$/.test(num)) return num.replace(".", "");
  return num;
}

/** Avalia uma fórmula aritmética em formato Excel (ponto decimal). Null se houver referências/funções. */
export function evalExcelArithmetic(formula: string): number | null {
  const s = formula.replace(/^=/, "").replace(/\s+/g, "");
  if (!/^[\d+\-*/().eE]+$/.test(s)) return null;
  return evalArithmetic(s);
}

function evalArithmetic(expr: string): number | null {
  let i = 0;
  const peek = () => expr[i];
  const parseExpr = (): number => {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = expr[i++];
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const parseTerm = (): number => {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = expr[i++];
      const r = parseFactor();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const parseFactor = (): number => {
    if (peek() === "-") {
      i++;
      return -parseFactor();
    }
    if (peek() === "+") {
      i++;
      return parseFactor();
    }
    if (peek() === "(") {
      i++;
      const v = parseExpr();
      if (peek() !== ")") throw new Error("paren");
      i++;
      return v;
    }
    const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(expr.slice(i));
    if (!m) throw new Error("num");
    i += m[0].length;
    return parseFloat(m[0]);
  };
  try {
    const v = parseExpr();
    return i === expr.length ? v : null;
  } catch {
    return null;
  }
}

/** Serializa especificações e comentários para a coluna F da planilha. */
export function commentsForExcel(node: Pick<BudgetNode, "comments" | "specs">) {
  const parts: string[] = [];
  if (node.comments?.trim()) parts.push(node.comments.trim());
  const specs = (node.specs ?? []).filter((s) => s.key.trim() && s.value.trim());
  if (specs.length) parts.push(specs.map((s) => `${s.key.trim()}: ${s.value.trim()}`).join(" · "));
  return parts.join("\n");
}

/** Faz o caminho inverso: separa linhas "Chave: valor · Chave: valor" em especificações. */
export function commentsFromExcel(text: string): { comments: string; specs: { key: string; value: string }[] } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const specs: { key: string; value: string }[] = [];
  const keep: string[] = [];
  for (const line of lines) {
    const pieces = line.split(" · ");
    const parsed = pieces.map((p) => /^([^:]{1,40}):\s*(.+)$/.exec(p.trim()));
    if (pieces.length > 1 && parsed.every(Boolean)) {
      parsed.forEach((m) => specs.push({ key: m![1].trim(), value: m![2].trim() }));
    } else keep.push(line);
  }
  return { comments: keep.join("\n").trim(), specs };
}
