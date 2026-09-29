// Leitura e escrita da "Planilha modelo" da empresa (abas Resumo, Venda e Custo).

import { Workbook, type CellWrite, type CellInfo } from "./xlsx/workbook.ts";
import { commentsForExcel, commentsFromExcel, evalExcelArithmetic, flatten, uid } from "../shared/calc.ts";
import { excelSerialToISO, isoToExcelSerial } from "../shared/format.ts";
import type { BudgetNode, CurrencyCode, Level, TopsiteProject } from "../shared/types.ts";
import { CURRENCIES } from "../shared/format.ts";

export const SHEET_RESUMO = "Planilha Resumo";
export const SHEET_VENDA = "Planilha Venda";
export const SHEET_CUSTO = "Planilha Custo";
export const FIRST_ROW = 9;
export const LAST_ROW = 3000;

export function isTopsiteWorkbook(wb: Workbook) {
  return wb.hasSheet(SHEET_RESUMO) && wb.hasSheet(SHEET_VENDA) && wb.hasSheet(SHEET_CUSTO);
}

const num = (c?: CellInfo) => (c && typeof c.v === "number" && isFinite(c.v) ? c.v : null);
const str = (c?: CellInfo) => (c && c.v !== null && c.v !== undefined ? String(c.v).trim() : "");

/** Lê um campo numérico de entrada que pode conter uma fórmula digitada pelo usuário. */
function readInput(c: CellInfo | undefined, warn: (m: string) => void, ref: string): { value: number | null; expr?: string } {
  if (!c) return { value: null };
  if (c.f) {
    const evaluated = evalExcelArithmetic(c.f);
    const value = evaluated ?? num(c) ?? null;
    if (evaluated === null && value === null) warn(`Célula ${ref} tem a fórmula "=${c.f}" que depende de outras células; revise o valor.`);
    return { value, expr: c.f };
  }
  if (typeof c.v === "number") return { value: c.v };
  if (typeof c.v === "string" && c.v.trim()) {
    const parsed = Number(c.v.replace(/\./g, "").replace(",", "."));
    if (isFinite(parsed)) return { value: parsed };
    warn(`Célula ${ref} contém texto ("${c.v}") onde era esperado um número.`);
  }
  return { value: null };
}

export interface ParsedTopsite {
  project: Omit<TopsiteProject, "id" | "createdAt" | "updatedAt" | "sync">;
  lastUsedRow: number;
}

export async function parseTopsite(wb: Workbook): Promise<ParsedTopsite> {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);

  const custo = await wb.readSheet(SHEET_CUSTO, {
    rows: [1, LAST_ROW],
    cols: ["C", "D", "E", "F", "G", "H", "I", "J", "AS", "AK", "AI"],
  });
  const venda = await wb.readSheet(SHEET_VENDA, { rows: [1, LAST_ROW], cols: ["AK"] });
  const resumo = await wb.readSheet(SHEET_RESUMO, { rows: [1, 200] });
  const C = custo.cells;

  // ---- estrutura de itens ----
  const roots: BudgetNode[] = [];
  const stack: BudgetNode[] = [];
  let lastUsedRow = FIRST_ROW - 1;
  let skippedOmissos = 0;

  for (let r = FIRST_ROW; r <= LAST_ROW; r++) {
    const levelRaw = num(C.get(`C${r}`));
    if (levelRaw !== null) lastUsedRow = r;
    const desc = str(C.get(`D${r}`));
    if (levelRaw === null) continue;
    const hasValues = ["E", "F", "G", "H", "I", "J"].some((c) => {
      const cell = C.get(`${c}${r}`);
      return cell && (cell.f || (cell.v !== null && cell.v !== ""));
    });
    if (!desc && !hasValues) continue; // linha vazia do modelo
    if (levelRaw > 4) {
      skippedOmissos++;
      continue;
    }
    let level = Math.max(1, Math.min(4, Math.round(levelRaw))) as Level;

    const node: BudgetNode = { id: uid(), level, description: desc || "(sem descrição)" };
    if (level === 4) {
      const supplier = str(C.get(`E${r}`));
      const f = commentsFromExcel(str(C.get(`F${r}`)));
      if (supplier) node.supplier = supplier;
      if (f.comments) node.comments = f.comments;
      if (f.specs.length) node.specs = f.specs;
      const unit = str(C.get(`G${r}`));
      if (unit) node.unit = unit;
      const q = readInput(C.get(`H${r}`), warn, `H${r}`);
      const m = readInput(C.get(`I${r}`), warn, `I${r}`);
      const l = readInput(C.get(`J${r}`), warn, `J${r}`);
      node.qty = q.value;
      if (q.expr) node.qtyExpr = q.expr;
      node.material = m.value;
      if (m.expr) node.materialExpr = m.expr;
      node.labor = l.value;
      if (l.expr) node.laborExpr = l.expr;
      const mk = num(venda.cells.get(`AK${r}`));
      if (mk) node.markup = mk;
    } else {
      node.children = [];
    }

    // encaixa na hierarquia (normaliza saltos de nível)
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if (!stack.length && level !== 1) {
      const root: BudgetNode = { id: uid(), level: 1, description: "PROJETO", children: [] };
      roots.push(root);
      stack.push(root);
      warn(`Linha ${r}: item sem nível 1 acima — agrupado em "PROJETO".`);
    }
    const parent = stack[stack.length - 1];
    if (!parent) {
      roots.push(node);
    } else {
      let p = parent;
      while (p.level < level - 1) {
        const filler: BudgetNode = { id: uid(), level: (p.level + 1) as Level, description: "Geral", children: [] };
        p.children!.push(filler);
        stack.push(filler);
        warn(`Linha ${r}: nível ${level} logo abaixo do nível ${p.level} — criado grupo "Geral".`);
        p = filler;
      }
      p.children!.push(node);
    }
    if (level < 4) stack.push(node);
  }
  if (skippedOmissos) warn(`${skippedOmissos} linha(s) de itens omissos (níveis 5/6) não foram importadas.`);

  // ---- cabeçalho e parâmetros ----
  const R = resumo.cells;
  const dateCell = R.get("E4");
  const date = typeof dateCell?.v === "number" ? excelSerialToISO(dateCell.v) : new Date().toISOString().slice(0, 10);
  const foreignRaw = str(C.get("AS1")).toUpperCase() as CurrencyCode;
  const foreign: CurrencyCode = foreignRaw in CURRENCIES ? foreignRaw : "USD";
  const rate = num(C.get("AS2")) ?? 1;

  // Regra oculta: Resumo divide valores por 1,1 quando HOJE() > Custo!AK5
  const e8 = R.get("E8");
  const bomb = num(C.get("AK5"));
  if (e8?.f && /\$AK\$5/.test(e8.f) && /\/1\.1/.test(e8.f) && bomb) {
    warn(
      `A aba Resumo contém uma regra oculta: a partir de ${excelSerialToISO(bomb).split("-").reverse().join("/")} os valores do Resumo passam a ser divididos por 1,1 (≈ −9,1%). A ferramenta não aplica essa regra.`,
    );
  }

  const project: ParsedTopsite["project"] = {
    kind: "topsite",
    info: {
      name: str(R.get("E1")) || "Novo orçamento",
      company: str(R.get("D4")) || "TOPSITE ENGINEERING",
      date,
      revision: str(R.get("G4")) || "R00",
      notes: str(R.get("D168")) || undefined,
    },
    params: {
      bdi: num(venda.cells.get("AK1")) ?? 0.15,
      admin: num(R.get("K163")) ?? 0.1,
      tax: num(R.get("K164")) ?? 0.16,
      adminLabel: str(R.get("D163")) || "Administração",
      taxLabel: str(R.get("D164")) || "Imposto",
      summaryLevel: num(R.get("K3")) ?? 2,
    },
    currency: { display: "BRL", foreign, rate, mode: "manual" },
    roots,
    warnings,
  };
  return { project, lastUsedRow };
}

/** Grava o projeto no arquivo Excel (somente as células de entrada). */
export async function writeTopsite(wb: Workbook, project: TopsiteProject, previousLastRow: number) {
  const custo: Record<string, CellWrite> = {};
  const venda: Record<string, CellWrite> = {};
  const resumo: Record<string, CellWrite> = {};

  const input = (value: number | null | undefined, expr?: string): CellWrite => {
    if (expr) return { f: expr, v: typeof value === "number" ? value : null };
    return typeof value === "number" && isFinite(value) ? value : null;
  };

  const rows = flatten(project.roots);
  if (rows.length > LAST_ROW - FIRST_ROW + 1) throw new Error(`O modelo comporta no máximo ${LAST_ROW - FIRST_ROW + 1} linhas.`);
  rows.forEach((node, i) => {
    const r = FIRST_ROW + i;
    const leaf = node.level === 4;
    custo[`C${r}`] = node.level;
    custo[`D${r}`] = node.description;
    custo[`E${r}`] = leaf ? node.supplier?.trim() || null : null;
    custo[`F${r}`] = leaf ? commentsForExcel(node) || null : null;
    custo[`G${r}`] = leaf ? node.unit?.trim() || null : null;
    custo[`H${r}`] = leaf ? input(node.qty, node.qtyExpr) : null;
    custo[`I${r}`] = leaf ? input(node.material, node.materialExpr) : null;
    custo[`J${r}`] = leaf ? input(node.labor, node.laborExpr) : null;
    venda[`AK${r}`] = leaf ? node.markup ?? 0 : 0;
  });
  const lastRow = FIRST_ROW + rows.length - 1;
  for (let r = lastRow + 1; r <= Math.max(previousLastRow, lastRow); r++) {
    for (const c of ["C", "D", "E", "F", "G", "H", "I", "J"]) custo[`${c}${r}`] = null;
  }

  const { info, params, currency } = project;
  resumo.E1 = info.name;
  resumo.D4 = info.company;
  if (info.date) resumo.E4 = isoToExcelSerial(info.date);
  resumo.G4 = info.revision;
  resumo.K163 = params.admin;
  resumo.K164 = params.tax;
  resumo.D163 = params.adminLabel;
  resumo.D164 = params.taxLabel;
  resumo.K3 = params.summaryLevel;
  resumo.D168 = info.notes?.trim() || null;
  venda.AK1 = params.bdi;
  // Coluna M ("Total (moeda)") usa AS1/AS2: gravamos a moeda escolhida e a cotação usada.
  custo.AS1 = currency.foreign;
  custo.AS2 = currency.rate;

  await wb.setCells(SHEET_CUSTO, custo);
  await wb.setCells(SHEET_VENDA, venda);
  await wb.setCells(SHEET_RESUMO, resumo);
  for (const s of [SHEET_CUSTO, SHEET_VENDA, SHEET_RESUMO]) await wb.stripFormulaCache(s);

  const printRow = Math.max(lastRow + 1, 12);
  wb.setDefinedName("_xlnm.Print_Area", wb.sheetIndex(SHEET_CUSTO), `'${SHEET_CUSTO}'!$A$1:$M$${printRow}`);
  wb.setDefinedName("_xlnm.Print_Area", wb.sheetIndex(SHEET_VENDA), `'${SHEET_VENDA}'!$A$1:$M$${printRow}`);
  return { lastRow };
}
