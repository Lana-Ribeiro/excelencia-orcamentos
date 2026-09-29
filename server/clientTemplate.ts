// Modelos de planilha dos clientes: detecção automática da estrutura, e preenchimento
// sem alterar o modelo (somente células de entrada recebem valores).

import { Workbook, colToNum, numToCol, splitRef, type CellInfo, type CellWrite } from "./xlsx/workbook.ts";
import { isoToExcelSerial } from "../shared/format.ts";
import type {
  ClientColumnKey,
  ClientColumns,
  ClientProject,
  ClientTemplate,
  TemplateField,
  TemplateItem,
  TemplateOutput,
  TemplateSection,
} from "../shared/types.ts";
import type { EvalCell } from "../shared/formula.ts";

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const HEADER_PATTERNS: [ClientColumnKey, RegExp][] = [
  ["unitPrice", /(unitari|preco unit|valor unit|r\$ ?unit|custo unit|p\. ?unit|vl\.? ?unit)/],
  ["total", /(^total|r\$ ?total|valor total|preco total|subtotal|vl\.? ?total)/],
  ["qty", /(quant|qtd|qtde)/],
  ["unit", /^(unid|un\.?$|und|u\.m\.?)/],
  ["applicable", /(aplicav)/],
  ["obs", /(observa|coment|^obs)/],
  ["desc", /(descri|atividade|servico|especifica|discrimina)/],
  ["code", /^(item|itens|cod|n[º°o]?\.?$|ref)/],
];

const LABEL_WORDS = /^(local|projeto|cliente|obra|endereco|area|data|revisao|construtora|responsavel|prazo|inauguracao|contato|e-?mail|telefone|cnpj|empresa|fornecedor|loja|marca|cidade|link)/;

export function textOf(c?: CellInfo) {
  return c && typeof c.v === "string" ? c.v.trim() : "";
}

function classifyHeader(text: string): ClientColumnKey | null {
  const t = norm(text);
  if (!t) return null;
  for (const [key, re] of HEADER_PATTERNS) if (re.test(t)) return key;
  return null;
}

function mergeEnd(merges: string[], ref: string) {
  const { col, row } = splitRef(ref);
  const c = colToNum(col);
  for (const m of merges) {
    const [a, b] = m.split(":");
    if (!b) continue;
    const A = splitRef(a),
      B = splitRef(b);
    if (row >= A.row && row <= B.row && c >= colToNum(A.col) && c <= colToNum(B.col)) return colToNum(B.col);
  }
  return c;
}

export interface Detection {
  template: Omit<ClientTemplate, "id" | "name" | "client" | "fileName" | "createdAt" | "updatedAt">;
  cells: Record<string, EvalCell>;
  warnings: string[];
}

export async function detectTemplate(wb: Workbook, preferredSheet?: string, override?: { headerRow?: number; columns?: ClientColumns }): Promise<Detection> {
  const warnings: string[] = [];
  // escolhe a aba com o melhor cabeçalho
  let best: { sheet: string; row: number; score: number; cols: ClientColumns } | null = null;
  const sheets = preferredSheet ? [preferredSheet] : wb.sheetNames;
  const data = new Map<string, Awaited<ReturnType<Workbook["readSheet"]>>>();
  for (const sheet of sheets) {
    const sd = await wb.readSheet(sheet, { expandShared: true });
    data.set(sheet, sd);
    const maxScan = Math.min(sd.maxRow, 80);
    for (let r = 1; r <= maxScan; r++) {
      const cols: ClientColumns = {};
      for (let c = 1; c <= Math.min(sd.maxCol, 40); c++) {
        const ref = numToCol(c) + r;
        const key = classifyHeader(textOf(sd.cells.get(ref)));
        if (key && !cols[key]) cols[key] = numToCol(c);
      }
      const score = Object.keys(cols).length + (cols.desc ? 1 : 0) + (cols.qty ? 1 : 0) + (cols.unitPrice ? 1 : 0);
      if (!best || score > best.score) best = { sheet, row: r, score, cols };
    }
  }
  if (!best || best.score < 4) throw new Error("Não encontrei um cabeçalho de itens (colunas como Descrição, Quantidade, Preço unitário).");

  const sheet = best.sheet;
  const sd = data.get(sheet)!;
  const headerRow = override?.headerRow ?? best.row;
  const columns: ClientColumns = override?.columns ?? best.cols;
  const cell = (col: string | undefined, r: number) => (col ? sd.cells.get(col + r) : undefined);
  const isFormula = (c?: CellInfo) => !!c && c.f !== undefined;

  // ---- início do rodapé: linha cujo total soma o intervalo inteiro ----
  const codeText = (r: number) => {
    const c = cell(columns.code, r);
    return textOf(c) || (typeof c?.v === "number" ? String(c.v) : "");
  };
  const isSectionRow = (r: number) => {
    const desc = textOf(cell(columns.desc, r));
    if (!desc) return false;
    const qtyText = textOf(cell(columns.qty, r));
    return /^\d+(\.0+)?\.?$/.test(codeText(r)) || (!!qtyText && classifyHeader(qtyText) === "qty");
  };
  const sectionRows: number[] = [];
  for (let r = headerRow + 1; r <= sd.maxRow; r++) if (isSectionRow(r)) sectionRows.push(r);
  let footerStart = sd.maxRow + 1;
  for (let r = headerRow + 1; r <= sd.maxRow; r++) {
    const f = cell(columns.total, r)?.f;
    const text = norm([codeText(r), textOf(cell(columns.desc, r)), textOf(sd.cells.get("C" + r))].join(" "));
    const ranges = f ? [...f.matchAll(/[A-Z]{1,3}\$?(\d+):\$?[A-Z]{1,3}\$?(\d+)/g)].map((m) => [+m[1], +m[2]]) : [];
    const coversSections = ranges.some(([a, b]) => sectionRows.filter((s) => s >= a && s <= b).length >= 2);
    const coversAll = sectionRows.length <= 1 && ranges.some(([a, b]) => a <= headerRow + 2 && b >= r - 3 && b - a > 8);
    if (coversSections || coversAll || /(total geral|valor total|total global|valor final)/.test(text)) {
      footerStart = r;
      break;
    }
  }

  // ---- seções e itens ----
  const sections: TemplateSection[] = [];
  const staticTotals: string[] = [];
  let current: TemplateSection | null = null;
  const editableRoles = ["desc", "qty", "unit", "unitPrice", "applicable", "obs"] as const;
  for (let r = headerRow + 1; r < footerStart; r++) {
    const code = codeText(r);
    const desc = textOf(cell(columns.desc, r));
    const totalCell = cell(columns.total, r);
    const isSubtotal = !desc && isFormula(totalCell) && /(SUBTOTAL|SUM)\s*\(/i.test(totalCell!.f!);

    if (isSectionRow(r)) {
      current = { row: r, code, title: desc, items: [] };
      sections.push(current);
      continue;
    }
    if (isSubtotal) {
      if (current && !current.totalCell) current.totalCell = `${columns.total}${r}`;
      continue;
    }
    const hasInputs = ["qty", "unitPrice"].some((k) => {
      const c = cell(columns[k as ClientColumnKey], r);
      return c !== undefined;
    });
    const isItem = (/^\d+[.,]\d+/.test(code) && (desc || hasInputs)) || (desc && hasInputs);
    if (!isItem) continue;
    if (!current) {
      current = { row: r, code: "", title: "Itens", items: [] };
      sections.push(current);
    }
    const editable: TemplateItem["editable"] = {};
    const defaults: TemplateItem["defaults"] = {};
    for (const role of editableRoles) {
      const col = columns[role];
      if (!col) continue;
      const c = cell(col, r);
      const formula = isFormula(c);
      editable[role] = role === "desc" ? !desc && !formula : !formula;
      if (c && c.v !== null && c.v !== undefined && c.v !== "") defaults[role] = typeof c.v === "boolean" ? String(c.v) : c.v;
    }
    if (columns.total) {
      const t = cell(columns.total, r);
      defaults.total = t && typeof t.v === "number" ? t.v : null;
      if (!isFormula(t)) {
        staticTotals.push(`${columns.total}${r}`);
        warnings.push(`Linha ${r}: a coluna de total não tem fórmula — a ferramenta preencherá o total (qtd × unitário).`);
      }
    }
    current.items.push({ row: r, code, desc, editable, defaults });
  }
  if (!sections.length) warnings.push("Nenhum item foi reconhecido — confira o mapeamento das colunas.");

  // ---- campos do cabeçalho ----
  const fields: TemplateField[] = [];
  const used = new Set<string>();
  const addField = (ref: string, label: string, v: CellInfo | undefined) => {
    if (used.has(ref) || isFormula(v)) return;
    used.add(ref);
    const val = v?.v;
    const isDateLabel = /(data|inaugura|entrega|prazo|inicio|termino)/.test(norm(label));
    let kind: TemplateField["kind"] = "text";
    if (isDateLabel) kind = "date";
    else if (/(area|m2|m²)/.test(norm(label))) kind = "number";
    const placeholder = typeof val === "string" && /^(preencher|xxx+|\[.*\])$/i.test(val.trim());
    fields.push({ cell: ref, label: label.replace(/[:\s]+$/, ""), kind, defaultValue: placeholder ? null : (val as string | number | null) ?? null });
  };
  for (let r = 1; r < headerRow; r++) {
    for (let c = 1; c <= Math.min(sd.maxCol, 30); c++) {
      const ref = numToCol(c) + r;
      const v = sd.cells.get(ref);
      const text = textOf(v);
      if (/^(preencher|xxx+)$/i.test(text)) {
        const above = textOf(sd.cells.get(numToCol(c) + (r - 1)));
        addField(ref, above || "Campo", v);
      }
    }
  }
  for (let r = 1; r < headerRow; r++) {
    for (let c = 1; c <= Math.min(sd.maxCol, 30); c++) {
      const ref = numToCol(c) + r;
      const text = textOf(sd.cells.get(ref));
      if (!text || text.length > 40) continue;
      const n = norm(text);
      const isLabel = /:\s*$/.test(text) || LABEL_WORDS.test(n);
      if (!isLabel || /^(preencher)$/i.test(text)) continue;
      const belowRef = numToCol(c) + (r + 1);
      const below = sd.cells.get(belowRef);
      const belowText = textOf(below);
      const rightRef = numToCol(mergeEnd(sd.merges, ref) + 1) + r;
      const right = sd.cells.get(rightRef);
      const rightText = textOf(right);
      const rightIsLabel = !!rightText && (/:\s*$/.test(rightText) || LABEL_WORDS.test(norm(rightText)));
      // valor abaixo (linha de rótulos seguida de linha de valores)
      if (r + 1 < headerRow && below && (typeof below.v === "number" || (belowText && !/:\s*$/.test(belowText) && !LABEL_WORDS.test(norm(belowText))))) {
        addField(belowRef, text, below);
      } else if (!rightIsLabel && (!rightText || !LABEL_WORDS.test(norm(rightText)))) {
        addField(rightRef, text, right);
      }
    }
  }

  // ---- parâmetros e resultados do rodapé ----
  const params: TemplateField[] = [];
  const outputs: TemplateOutput[] = [];
  const labelLeft = (r: number, c: number) => {
    for (let x = c - 1; x >= 1; x--) {
      const t = textOf(sd.cells.get(numToCol(x) + r));
      if (t && !/^\d+\.?$/.test(t)) return t;
    }
    return "";
  };
  for (let r = footerStart; r <= sd.maxRow; r++) {
    for (let c = 1; c <= Math.min(sd.maxCol, 30); c++) {
      const ref = numToCol(c) + r;
      const v = sd.cells.get(ref);
      if (!v) continue;
      const label = labelLeft(r, c);
      if (!label) continue;
      if (isFormula(v)) {
        const pctLike = /(%|percent)/.test(norm(label));
        outputs.push({ cell: ref, label, kind: pctLike ? "percent" : "money" });
      } else if (typeof v.v === "number") {
        const pctLike = (v.v > 0 && v.v < 1) || (v.v === 0 && /(taxa|imposto|faturamento|%|bdi|percent)/.test(norm(label)));
        params.push({ cell: ref, label, kind: pctLike ? "percent" : "number", defaultValue: v.v });
      } else if (columns.obs && numToCol(c) === columns.obs && typeof v.v === "string") {
        params.push({ cell: ref, label: `Explicação — ${labelLeft(r, colToNum(columns.obs)) || label}`, kind: "text", defaultValue: null });
      }
    }
  }
  // Rótulos mais claros para resultados que dividem linha com um parâmetro
  for (const o of outputs) if (params.some((p) => splitRef(p.cell).row === splitRef(o.cell).row && p.kind !== "text")) o.label = `${o.label} — valor`;

  const cells: Record<string, EvalCell> = {};
  for (const [ref, c] of sd.cells) if (c.v !== null || c.f !== undefined) cells[ref] = { v: c.v, f: c.f || undefined };

  return {
    template: {
      sheet,
      sheets: wb.sheetNames,
      headerRow,
      columns,
      sections,
      fields,
      params,
      outputs,
      staticTotals,
      grandTotalCell: footerStart <= sd.maxRow && columns.total ? `${columns.total}${footerStart}` : undefined,
    },
    cells,
    warnings,
  };
}

/** Monta as células que serão gravadas no arquivo do cliente. */
export function clientWrites(template: ClientTemplate, project: ClientProject): Record<string, CellWrite> {
  const out: Record<string, CellWrite> = {};
  const fieldKinds = new Map<string, TemplateField["kind"]>();
  [...template.fields, ...template.params].forEach((f) => fieldKinds.set(f.cell, f.kind));
  for (const [ref, raw] of Object.entries(project.values)) {
    if (raw === undefined) continue;
    const kind = fieldKinds.get(ref);
    if (kind === "date" && typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) out[ref] = isoToExcelSerial(raw);
    else out[ref] = raw === "" ? null : raw;
  }
  // linhas sem fórmula de total: a ferramenta grava qtd × unitário
  const { qty, unitPrice, total } = template.columns;
  if (qty && unitPrice && total) {
    for (const totalRef of template.staticTotals ?? []) {
      const row = splitRef(totalRef).row;
      const item = template.sections.flatMap((s) => s.items).find((it) => it.row === row);
      const q = numeric(project.values[`${qty}${row}`] ?? item?.defaults.qty);
      const p = numeric(project.values[`${unitPrice}${row}`] ?? item?.defaults.unitPrice);
      if (q !== null && p !== null) out[totalRef] = q * p;
    }
  }
  return out;
}

function numeric(v: unknown) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

export async function writeClient(wb: Workbook, template: ClientTemplate, project: ClientProject) {
  await wb.setCells(template.sheet, clientWrites(template, project));
  for (const s of wb.sheetNames) await wb.stripFormulaCache(s);
}
