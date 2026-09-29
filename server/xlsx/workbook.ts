// Leitura e escrita cirúrgica de arquivos .xlsx/.xlsm.
//
// A escrita altera somente as células pedidas, direto no XML da planilha, preservando
// todo o resto do arquivo (macros VBA, estilos, fórmulas, imagens, validações,
// áreas de impressão). Depois pede ao Excel/LibreOffice para recalcular ao abrir.

import JSZip from "jszip";

export type CellValue = string | number | boolean | null;

export interface CellInfo {
  v: CellValue;
  f?: string; // fórmula (sem "="), já expandida quando compartilhada
  s?: string; // índice de estilo
}

export interface SheetData {
  cells: Map<string, CellInfo>;
  merges: string[];
  maxRow: number;
  maxCol: number;
}

export type CellWrite = CellValue | { f: string; v?: CellValue };

// ---------- utilidades de referência ----------

export function colToNum(col: string) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export function numToCol(n: number) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
export function splitRef(ref: string) {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref);
  if (!m) throw new Error("Referência inválida: " + ref);
  return { col: m[1], row: parseInt(m[2], 10) };
}

const XML_ENT: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&apos;": "'" };
export function unescapeXml(s: string) {
  return s
    .replace(/&(lt|gt|amp|quot|apos);/g, (m) => XML_ENT[m])
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/_x000D_/g, "\r");
}
export function escapeXml(s: string) {
  return s
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attr(attrs: string, name: string) {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : undefined;
}

// ---------- deslocamento de fórmulas compartilhadas ----------

/** Desloca referências relativas de uma fórmula (usado para expandir fórmulas compartilhadas). */
export function shiftFormula(formula: string, dRow: number, dCol: number) {
  if (!dRow && !dCol) return formula;
  let out = "";
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      const end = formula.indexOf('"', i + 1);
      const j = end < 0 ? formula.length : end + 1;
      out += formula.slice(i, j);
      i = j;
      continue;
    }
    if (ch === "'") {
      const end = formula.indexOf("'", i + 1);
      const j = end < 0 ? formula.length : end + 1;
      out += formula.slice(i, j);
      i = j;
      continue;
    }
    const m = /^(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/.exec(formula.slice(i));
    const prev = i > 0 ? formula[i - 1] : "";
    if (m && !/[A-Za-z0-9_.]/.test(prev)) {
      const [whole, cAbs, col, rAbs, row] = m;
      const newCol = cAbs ? col : numToCol(Math.max(1, colToNum(col) + dCol));
      const newRow = rAbs ? row : String(Math.max(1, parseInt(row, 10) + dRow));
      out += `${cAbs}${newCol}${rAbs}${newRow}`;
      i += whole.length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// ---------- Workbook ----------

export class Workbook {
  private sheetPaths = new Map<string, string>();
  private sheetXml = new Map<string, string>();
  private dirty = new Set<string>();
  private sst: string[] | null = null;
  sheetNames: string[] = [];
  private workbookXml = "";

  private constructor(private zip: JSZip) {}

  static async load(buf: ArrayBuffer | Uint8Array) {
    const zip = await JSZip.loadAsync(buf);
    const wb = new Workbook(zip);
    await wb.init();
    return wb;
  }

  private async init() {
    this.workbookXml = await this.text("xl/workbook.xml");
    const rels = await this.text("xl/_rels/workbook.xml.rels");
    const relMap = new Map<string, string>();
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = attr(m[1], "Id");
      const target = attr(m[1], "Target");
      if (id && target) relMap.set(id, target.startsWith("/") ? target.slice(1) : "xl/" + target);
    }
    for (const m of this.workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
      const name = unescapeXml(attr(m[1], "name") ?? "");
      const rid = attr(m[1], "r:id");
      if (rid && relMap.has(rid)) {
        this.sheetPaths.set(name, relMap.get(rid)!);
        this.sheetNames.push(name);
      }
    }
  }

  private async text(path: string) {
    const f = this.zip.file(path);
    if (!f) throw new Error(`Parte ausente no arquivo: ${path}`);
    return f.async("string");
  }

  hasSheet(name: string) {
    return this.sheetPaths.has(name);
  }

  private async xml(sheet: string) {
    if (!this.sheetXml.has(sheet)) {
      const path = this.sheetPaths.get(sheet);
      if (!path) throw new Error(`Aba não encontrada: ${sheet}`);
      this.sheetXml.set(sheet, await this.text(path));
    }
    return this.sheetXml.get(sheet)!;
  }

  private async sharedStrings() {
    if (this.sst) return this.sst;
    const f = this.zip.file("xl/sharedStrings.xml");
    const xml = f ? await f.async("string") : "";
    this.sst = [];
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const body = m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
      let s = "";
      for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) s += t[1] ?? "";
      this.sst.push(unescapeXml(s));
    }
    return this.sst;
  }

  /**
   * Lê células de uma aba. `rows`/`cols` limitam a leitura (abas grandes).
   * Fórmulas compartilhadas são expandidas quando `expandShared` é verdadeiro.
   */
  async readSheet(
    sheet: string,
    opts: { rows?: [number, number]; cols?: string[]; expandShared?: boolean } = {},
  ): Promise<SheetData> {
    const xml = await this.xml(sheet);
    const sst = await this.sharedStrings();
    const cells = new Map<string, CellInfo>();
    const colSet = opts.cols ? new Set(opts.cols) : null;
    const masters = new Map<string, { row: number; col: number; f: string }>();
    const sharedChildren: { ref: string; si: string; row: number; col: number }[] = [];
    let maxRow = 0,
      maxCol = 0;

    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    for (const rm of xml.matchAll(rowRe)) {
      const r = parseInt(attr(rm[1], "r") ?? "0", 10);
      if (opts.rows && (r < opts.rows[0] || r > opts.rows[1])) {
        if (opts.rows && r > opts.rows[1] && !opts.expandShared) break;
        if (!opts.expandShared) continue;
      }
      const inRange = !opts.rows || (r >= opts.rows[0] && r <= opts.rows[1]);
      const body = rm[2];
      if (!body) continue;
      for (const cm of body.matchAll(cellRe)) {
        const ref = attr(cm[1], "r");
        if (!ref) continue;
        const { col, row } = splitRef(ref);
        const inner = cm[2] ?? "";
        const fm = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner);
        if (fm && opts.expandShared && attr(fm[1], "t") === "shared") {
          const si = attr(fm[1], "si")!;
          if (fm[2] !== undefined && attr(fm[1], "ref")) masters.set(si, { row, col: colToNum(col), f: unescapeXml(fm[2]) });
        }
        if (!inRange || (colSet && !colSet.has(col))) continue;
        const t = attr(cm[1], "t");
        const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
        let v: CellValue = null;
        if (t === "s" && vm) v = sst[parseInt(vm[1], 10)] ?? "";
        else if (t === "inlineStr") {
          let s = "";
          for (const tm of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += tm[1];
          v = unescapeXml(s);
        } else if (t === "str" || t === "e") v = vm ? unescapeXml(vm[1]) : null;
        else if (t === "b") v = vm ? vm[1] === "1" : null;
        else if (vm) v = parseFloat(vm[1]);
        const info: CellInfo = { v };
        const s = attr(cm[1], "s");
        if (s) info.s = s;
        if (fm) {
          if (fm[2] !== undefined && fm[2] !== "") info.f = unescapeXml(fm[2]);
          else if (attr(fm[1], "t") === "shared") {
            sharedChildren.push({ ref, si: attr(fm[1], "si")!, row, col: colToNum(col) });
            info.f = "";
          } else info.f = "";
        }
        // célula só com estilo – guardamos apenas se tiver estilo
        if (v === null && info.f === undefined && !info.s) continue;
        cells.set(ref, info);
        maxRow = Math.max(maxRow, row);
        maxCol = Math.max(maxCol, colToNum(col));
      }
    }
    if (opts.expandShared)
      for (const ch of sharedChildren) {
        const m = masters.get(ch.si);
        const cell = cells.get(ch.ref);
        if (cell) cell.f = m ? shiftFormula(m.f, ch.row - m.row, ch.col - m.col) : "";
      }
    const merges = [...xml.matchAll(/<mergeCell\s+ref="([^"]+)"/g)].map((m) => m[1]);
    return { cells, merges, maxRow, maxCol };
  }

  // ---------- escrita ----------

  /** Altera células preservando o estilo de cada uma. */
  async setCells(sheet: string, updates: Record<string, CellWrite>) {
    let xml = await this.xml(sheet);
    const byRow = new Map<number, [string, CellWrite][]>();
    for (const [ref, val] of Object.entries(updates)) {
      const { row } = splitRef(ref);
      if (!byRow.has(row)) byRow.set(row, []);
      byRow.get(row)!.push([ref, val]);
    }
    if (!byRow.size) return;

    const colStyles = parseColStyles(xml);
    const sdStart = xml.indexOf("<sheetData");
    const sdOpenEnd = xml.indexOf(">", sdStart);
    const selfClosingSheetData = xml[sdOpenEnd - 1] === "/";
    if (selfClosingSheetData) {
      xml = xml.slice(0, sdOpenEnd - 1) + "></sheetData>" + xml.slice(sdOpenEnd + 1);
    }
    // localiza todas as linhas uma única vez
    const rowPos = new Map<number, { start: number; end: number }>();
    const rowRe = /<row\b([^>]*?)(\/>|>[\s\S]*?<\/row>)/g;
    rowRe.lastIndex = sdStart;
    const sdEnd = xml.indexOf("</sheetData>", sdStart);
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(xml)) && m.index < sdEnd) {
      const r = parseInt(attr(m[1], "r") ?? "0", 10);
      rowPos.set(r, { start: m.index, end: m.index + m[0].length });
    }

    // processa de baixo para cima para manter as posições válidas
    const rowsDesc = [...byRow.keys()].sort((a, b) => b - a);
    for (const r of rowsDesc) {
      const pos = rowPos.get(r);
      const cellsForRow = byRow.get(r)!;
      if (pos) {
        const rowXml = xml.slice(pos.start, pos.end);
        const newRow = patchRow(rowXml, cellsForRow, colStyles);
        xml = xml.slice(0, pos.start) + newRow + xml.slice(pos.end);
      } else {
        // cria a linha na posição correta
        const cellsXml = cellsForRow
          .sort((a, b) => colToNum(splitRef(a[0]).col) - colToNum(splitRef(b[0]).col))
          .map(([ref, val]) => cellXml(ref, val, colStyles.get(colToNum(splitRef(ref).col))))
          .join("");
        const newRow = `<row r="${r}">${cellsXml}</row>`;
        const after = [...rowPos.keys()].filter((k) => k > r).sort((a, b) => a - b)[0];
        const insertAt = after !== undefined ? rowPos.get(after)!.start : xml.indexOf("</sheetData>", sdStart);
        xml = xml.slice(0, insertAt) + newRow + xml.slice(insertAt);
      }
    }
    this.sheetXml.set(sheet, xml);
    this.dirty.add(sheet);
  }

  /** Remove os valores em cache de todas as fórmulas da aba (força o recálculo ao abrir). */
  async stripFormulaCache(sheet: string) {
    const xml = await this.xml(sheet);
    // [^<]* mantém a busca linear (texto de fórmula/valor nunca contém "<" sem escape)
    const out = xml.replace(
      /<c\b([^>]*)>(<f\b[^>]*\/>|<f\b[^>]*>[^<]*<\/f>)(?:<v>[^<]*<\/v>|<v\/>)<\/c>/g,
      (_m, attrs: string, f: string) => `<c${attrs.replace(/\s+t="(str|n|b|e)"/, "")}>${f}</c>`,
    );
    this.sheetXml.set(sheet, out);
    this.dirty.add(sheet);
  }

  /** Atualiza (ou cria) um nome definido, ex.: área de impressão. */
  setDefinedName(name: string, localSheetId: number | null, value: string) {
    const esc = escapeXml(value).replace(/&quot;/g, '"');
    const local = localSheetId === null ? "" : ` localSheetId="${localSheetId}"`;
    const re = new RegExp(`<definedName name="${name.replace(/\./g, "\\.")}"${local}([^>]*)>[\\s\\S]*?<\\/definedName>`);
    if (re.test(this.workbookXml)) {
      // função de substituição: o valor contém "$" (ex.: $A$1), que não pode virar referência de grupo
      this.workbookXml = this.workbookXml.replace(re, (_m, rest: string) => `<definedName name="${name}"${local}${rest}>${esc}</definedName>`);
    }
  }

  sheetIndex(name: string) {
    return this.sheetNames.indexOf(name);
  }

  async save(): Promise<Uint8Array> {
    for (const sheet of this.dirty) this.zip.file(this.sheetPaths.get(sheet)!, this.sheetXml.get(sheet)!);

    // Recalcular tudo ao abrir e descartar a cadeia de cálculo antiga.
    let wbXml = this.workbookXml;
    if (/<calcPr\b/.test(wbXml)) {
      wbXml = wbXml.replace(/<calcPr\b([^>]*?)(\/?)>/, (_m, attrs: string, slash: string) => {
        const cleaned = attrs.replace(/\s+fullCalcOnLoad="[^"]*"/, "");
        return `<calcPr${cleaned} fullCalcOnLoad="1"${slash}>`;
      });
    } else {
      wbXml = wbXml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
    }
    this.zip.file("xl/workbook.xml", wbXml);
    if (this.zip.file("xl/calcChain.xml")) {
      this.zip.remove("xl/calcChain.xml");
      const ct = await this.text("[Content_Types].xml");
      this.zip.file("[Content_Types].xml", ct.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ""));
      const rels = await this.text("xl/_rels/workbook.xml.rels");
      this.zip.file("xl/_rels/workbook.xml.rels", rels.replace(/<Relationship[^>]*Target="[^"]*calcChain\.xml"[^>]*\/>/, ""));
    }
    return this.zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  }
}

function parseColStyles(xml: string) {
  const map = new Map<number, string>();
  const cols = /<cols>([\s\S]*?)<\/cols>/.exec(xml);
  if (!cols) return map;
  for (const m of cols[1].matchAll(/<col\b([^>]*)\/>/g)) {
    const min = parseInt(attr(m[1], "min") ?? "0", 10);
    const max = parseInt(attr(m[1], "max") ?? "0", 10);
    const style = attr(m[1], "style");
    if (style) for (let c = min; c <= Math.min(max, 200); c++) map.set(c, style);
  }
  return map;
}

function cellXml(ref: string, val: CellWrite, style?: string) {
  const s = style ? ` s="${style}"` : "";
  if (val === null || val === undefined || val === "") return `<c r="${ref}"${s}/>`;
  if (typeof val === "object") {
    const f = `<f>${escapeXml(val.f)}</f>`;
    if (typeof val.v === "number" && isFinite(val.v)) return `<c r="${ref}"${s}>${f}<v>${val.v}</v></c>`;
    if (typeof val.v === "string") return `<c r="${ref}"${s} t="str">${f}<v>${escapeXml(val.v)}</v></c>`;
    return `<c r="${ref}"${s}>${f}</c>`;
  }
  if (typeof val === "number") return isFinite(val) ? `<c r="${ref}"${s}><v>${val}</v></c>` : `<c r="${ref}"${s}/>`;
  if (typeof val === "boolean") return `<c r="${ref}"${s} t="b"><v>${val ? 1 : 0}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(val)}</t></is></c>`;
}

function patchRow(rowXml: string, updates: [string, CellWrite][], colStyles: Map<number, string>) {
  const selfClosing = /^<row\b[^>]*\/>$/.test(rowXml);
  const openEnd = rowXml.indexOf(">") + 1;
  const openTag = selfClosing ? rowXml.slice(0, -2) + ">" : rowXml.slice(0, openEnd);
  const body = selfClosing ? "" : rowXml.slice(openEnd, rowXml.length - "</row>".length);
  const rowStyle = /customFormat="1"/.test(openTag) ? attr(openTag, "s") : undefined;

  const cells: { col: number; xml: string; ref: string; attrs: string }[] = [];
  for (const m of body.matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)) {
    const ref = attr(m[1], "r")!;
    cells.push({ col: colToNum(splitRef(ref).col), xml: m[0], ref, attrs: m[1] });
  }
  for (const [ref, val] of updates) {
    const col = colToNum(splitRef(ref).col);
    const existing = cells.find((c) => c.col === col);
    if (existing) {
      existing.xml = cellXml(ref, val, attr(existing.attrs, "s"));
    } else {
      cells.push({ col, ref, attrs: "", xml: cellXml(ref, val, rowStyle ?? colStyles.get(col)) });
    }
  }
  cells.sort((a, b) => a.col - b.col);
  // "spans" é apenas uma dica de otimização; removemos para não ficar inconsistente
  const tag = openTag.replace(/\s+spans="[^"]*"/, "");
  return tag + cells.map((c) => c.xml).join("") + "</row>";
}
