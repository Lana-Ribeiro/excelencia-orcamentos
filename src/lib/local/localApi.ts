// Versão online (site estático): a mesma API do servidor local, executada no navegador.
// Orçamentos e planilhas ficam no IndexedDB deste navegador; o Excel é gerado no download.

import JSZip from "jszip";
import { idb } from "./idb";
import { Workbook } from "../../../server/xlsx/workbook";
import { isTopsiteWorkbook, parseTopsite, writeTopsite } from "../../../server/topsite";
import { detectTemplate, writeClient } from "../../../server/clientTemplate";
import { summarizeProject } from "../../../shared/summary";
import { uid } from "../../../shared/calc";
import { CURRENCIES, CURRENCY_CODES } from "../../../shared/format";
import type { EvalCell } from "../../../shared/formula";
import type { AnyProject, ClientColumns, ClientProject, ClientTemplate, CurrencyCode, FxRate, ProjectSummary, SyncState, TopsiteProject } from "../../../shared/types";

type TemplateData = { template: ClientTemplate; cells: Record<string, EvalCell> };
const BASE_MODEL = "arquivo:modelo-base";
const now = () => new Date().toISOString();

function safeFileName(s: string) {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\w\s.-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "orcamento"
  );
}

async function file(key: string) {
  const b = await idb.get<Uint8Array>(key);
  if (!b) throw new Error("Planilha de origem não encontrada neste navegador.");
  return b;
}
async function getProjectRaw(id: string) {
  const p = await idb.get<AnyProject>(`projeto:${id}`);
  if (!p) throw new Error("Orçamento não encontrado neste navegador.");
  return p;
}
async function getTemplateData(id: string) {
  const t = await idb.get<TemplateData>(`modelo:${id}`);
  if (!t) throw new Error("Modelo não encontrado.");
  return t;
}

// ---------- criação e importação ----------
async function createTopsite(input: { name: string; client?: string; company?: string; display?: CurrencyCode; rate?: number }) {
  const wb = await Workbook.load(await file(BASE_MODEL));
  const parsed = await parseTopsite(wb);
  const id = uid("p");
  const project: TopsiteProject = {
    ...parsed.project,
    id,
    info: { ...parsed.project.info, name: input.name, client: input.client, company: input.company?.trim() || "TOPSITE ENGINEERING", date: now().slice(0, 10), revision: "R00" },
    roots: [{ id: uid(), level: 1, description: input.name.toUpperCase(), children: [] }],
    currency: {
      ...parsed.project.currency,
      display: input.display ?? "BRL",
      ...(input.display && input.display !== "BRL" && input.rate ? { foreign: input.display, rate: input.rate, mode: "live" as const, rateAt: now() } : {}),
    },
    createdAt: now(),
    updatedAt: now(),
    sync: { excelFile: `TOPSITE_PROPOSAL_${safeFileName(input.name).toUpperCase()}_R00.xlsm`, lastRow: parsed.lastUsedRow, baseKey: BASE_MODEL },
  };
  await idb.set(`projeto:${id}`, project);
  return project;
}

async function createClient(templateId: string, input: { name: string; client?: string; display?: CurrencyCode; rate?: number }) {
  const { template } = await getTemplateData(templateId);
  const id = uid("p");
  const ext = template.fileName.match(/\.xls[xm]$/i)?.[0] ?? ".xlsx";
  const project: ClientProject = {
    id,
    kind: "client",
    templateId,
    info: { name: input.name, client: input.client ?? template.client, revision: "R00" },
    values: {},
    currency: { display: input.display ?? "BRL", foreign: input.display && input.display !== "BRL" ? input.display : "USD", rate: input.rate ?? 5.2, mode: "live" },
    createdAt: now(),
    updatedAt: now(),
    sync: { excelFile: `${safeFileName(input.name)}${ext}`, baseKey: `arquivo:modelo:${templateId}` },
  };
  await idb.set(`projeto:${id}`, project);
  return project;
}

export async function createTemplate(bytes: Uint8Array, fileName: string, name: string, client: string) {
  const det = await detectTemplate(await Workbook.load(bytes));
  const id = uid("t");
  const template: ClientTemplate = { ...det.template, id, name, client, fileName, warnings: det.warnings, createdAt: now(), updatedAt: now() };
  await idb.set(`arquivo:modelo:${id}`, bytes);
  await idb.set(`modelo:${id}`, { template, cells: det.cells } satisfies TemplateData);
  return template;
}

export async function importBytes(bytes: Uint8Array, fileName: string, meta: { name?: string; client?: string; location?: string; area?: number } = {}) {
  const wb = await Workbook.load(bytes);
  if (isTopsiteWorkbook(wb)) {
    const parsed = await parseTopsite(wb);
    const id = uid("p");
    const info = { ...parsed.project.info };
    if (meta.client) info.client = meta.client;
    if (meta.location) info.location = meta.location;
    if (meta.area) info.area = meta.area;
    const project: TopsiteProject = {
      ...parsed.project,
      id,
      info,
      createdAt: now(),
      updatedAt: now(),
      sync: { excelFile: fileName, lastRow: parsed.lastUsedRow, baseKey: `arquivo:projeto:${id}` },
    };
    await idb.set(`arquivo:projeto:${id}`, bytes);
    await idb.set(`projeto:${id}`, project);
    return { type: "project" as const, id };
  }
  const t = await createTemplate(bytes, fileName, meta.name ?? fileName.replace(/\.(xlsm|xlsx)$/i, ""), meta.client ?? "");
  return { type: "template" as const, id: t.id, warnings: t.warnings ?? [] };
}

// ---------- Excel ----------
async function buildExcel(p: AnyProject) {
  if (p.kind === "topsite") {
    const wb = await Workbook.load(await file(p.sync?.baseKey ?? BASE_MODEL));
    await writeTopsite(wb, p, p.sync?.lastRow ?? 437);
    return wb.save();
  }
  const { template } = await getTemplateData(p.templateId);
  const wb = await Workbook.load(await file(`arquivo:modelo:${p.templateId}`));
  await writeClient(wb, template, p);
  return wb.save();
}

function saveBlob(bytes: Uint8Array, name: string) {
  const type = name.endsWith(".xlsm") ? "application/vnd.ms-excel.sheet.macroEnabled.12" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ---------- cotações ----------
const FX_KEY = "excelencia:cotacoes";
async function fetchRates(force = false): Promise<{ rates: FxRate[]; offline: boolean }> {
  let cached: { at: number; rates: FxRate[] } | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(FX_KEY) ?? "null");
  } catch {
    /* sem cache */
  }
  if (!force && cached && Date.now() - cached.at < 10 * 60 * 1000) return { rates: cached.rates, offline: false };
  const wanted: CurrencyCode[] = CURRENCY_CODES.filter((c) => c !== "BRL");
  const settled = await Promise.allSettled(
    wanted.map(async (code): Promise<FxRate> => {
      const res = await fetch(`https://economia.awesomeapi.com.br/json/last/${code}-BRL`);
      const q = (await res.json())[`${code}BRL`];
      const rate = parseFloat(q?.bid);
      if (!(rate > 0)) throw new Error("sem cotação");
      return { code, name: CURRENCIES[code].name, rate, at: q.create_date ? new Date(q.create_date.replace(" ", "T") + "-03:00").toISOString() : now(), source: "AwesomeAPI (comercial)" } satisfies FxRate;
    }),
  );
  let rates = settled.filter((s): s is PromiseFulfilledResult<FxRate> => s.status === "fulfilled").map((s) => s.value);
  const missing = wanted.filter((c) => !rates.some((r) => r.code === c));
  if (missing.length) {
    try {
      const data = await (await fetch("https://open.er-api.com/v6/latest/BRL")).json();
      rates = rates.concat(missing.filter((c) => data.rates?.[c] > 0).map((code) => ({ code, name: CURRENCIES[code].name, rate: 1 / data.rates[code], at: now(), source: "ExchangeRate-API" })));
    } catch {
      /* offline */
    }
  }
  if (rates.length) {
    rates.sort((a, b) => wanted.indexOf(a.code) - wanted.indexOf(b.code));
    try {
      localStorage.setItem(FX_KEY, JSON.stringify({ at: Date.now(), rates }));
    } catch {
      /* armazenamento indisponível */
    }
    return { rates, offline: false };
  }
  return { rates: cached?.rates ?? [], offline: true };
}

// ---------- API ----------
export const localApi = {
  health: async () => ({ ok: true, ai: { configured: false, model: "" } }),
  fx: (force = false) => fetchRates(force),
  projects: async (): Promise<ProjectSummary[]> => {
    const all = await idb.values<AnyProject>("projeto:");
    const out: ProjectSummary[] = [];
    for (const p of all) {
      const tpl = p.kind === "client" ? ((await idb.get<TemplateData>(`modelo:${p.templateId}`)) ?? null) : null;
      out.push(summarizeProject(p, tpl));
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  project: async (id: string) => {
    const project = await getProjectRaw(id);
    const extra = project.kind === "client" ? await getTemplateData(project.templateId) : null;
    return { project, reimported: false, template: extra?.template, cells: extra?.cells };
  },
  createProject: async (body: Record<string, unknown>): Promise<AnyProject> => {
    const b = body as { kind?: string; templateId?: string; name: string; client?: string; company?: string; display?: CurrencyCode; rate?: number };
    if (!b.name?.trim()) throw new Error("Informe o nome do orçamento.");
    return b.kind === "client" ? createClient(b.templateId!, b) : createTopsite(b);
  },
  saveProject: async (p: AnyProject): Promise<{ sync: SyncState }> => {
    const current = await getProjectRaw(p.id);
    const sync: SyncState = { ...(current.sync ?? { excelFile: "orcamento.xlsx" }), lastExcelWrite: now(), lastError: null };
    await idb.set(`projeto:${p.id}`, { ...p, kind: current.kind, sync, updatedAt: now() });
    return { sync };
  },
  duplicate: async (id: string): Promise<AnyProject> => {
    const p = await getProjectRaw(id);
    const newId = uid("p");
    const copy = { ...p, id: newId, info: { ...p.info, name: p.info.name + " (cópia)" }, createdAt: now(), updatedAt: now() } as AnyProject;
    if (p.sync?.baseKey === `arquivo:projeto:${id}`) {
      await idb.set(`arquivo:projeto:${newId}`, await file(p.sync.baseKey));
      copy.sync = { ...p.sync, baseKey: `arquivo:projeto:${newId}` };
    }
    await idb.set(`projeto:${newId}`, copy);
    return copy;
  },
  deleteProject: async (id: string) => {
    await idb.del(`projeto:${id}`);
    await idb.del(`arquivo:projeto:${id}`);
    return { ok: true as const };
  },
  downloadExcel: async (id: string) => {
    const p = await getProjectRaw(id);
    saveBlob(await buildExcel(p), p.sync?.excelFile ?? "orcamento.xlsx");
  },
  templates: async () => {
    const all = await idb.values<TemplateData>("modelo:");
    const projects = await idb.values<AnyProject>("projeto:");
    return all
      .map(({ template }) => ({ ...template, projects: projects.filter((p) => p.kind === "client" && p.templateId === template.id).length }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  template: (id: string) => getTemplateData(id),
  updateTemplate: async (id: string, patch: { name?: string; client?: string; headerRow?: number; columns?: ClientColumns }): Promise<ClientTemplate> => {
    const data = await getTemplateData(id);
    let next: ClientTemplate = { ...data.template, name: patch.name ?? data.template.name, client: patch.client ?? data.template.client, updatedAt: now() };
    let cells = data.cells;
    if (patch.headerRow || patch.columns) {
      const det = await detectTemplate(await Workbook.load(await file(`arquivo:modelo:${id}`)), data.template.sheet, {
        headerRow: patch.headerRow ?? data.template.headerRow,
        columns: patch.columns ?? data.template.columns,
      });
      next = { ...next, ...det.template, warnings: det.warnings };
      cells = det.cells;
    }
    await idb.set(`modelo:${id}`, { template: next, cells });
    return next;
  },
  deleteTemplate: async (id: string) => {
    await idb.del(`modelo:${id}`);
    await idb.del(`arquivo:modelo:${id}`);
    return { ok: true as const };
  },
  importFile: async (f: File, meta: { templateName?: string; client?: string } = {}) => {
    if (!/\.(xlsx|xlsm)$/i.test(f.name)) throw new Error("Envie um arquivo .xlsx ou .xlsm.");
    return importBytes(new Uint8Array(await f.arrayBuffer()), f.name, { name: meta.templateName, client: meta.client });
  },
};

// ---------- exemplos criptografados (tela de senha) ----------
const MAGIC = [69, 88, 67, 50]; // "EXC2"

async function decrypt(buf: ArrayBuffer, password: string) {
  const bytes = new Uint8Array(buf);
  if (!MAGIC.every((b, i) => bytes[i] === b)) throw new Error("Pacote de exemplos inválido.");
  const salt = bytes.slice(4, 20);
  const iv = bytes.slice(20, 32);
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 250000 }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, bytes.slice(32)));
}

export const gate = {
  async unlocked() {
    return !!(await idb.get<boolean>("meta:liberado"));
  },
  async hasPackage() {
    try {
      const r = await fetch("exemplos.enc", { method: "HEAD", cache: "no-store" });
      return r.ok;
    } catch {
      return false;
    }
  },
  /** Abre o pacote com a senha e cria os exemplos. Lança "Senha incorreta." se não abrir. */
  async unlock(password: string) {
    const res = await fetch("exemplos.enc", { cache: "no-store" });
    if (!res.ok) throw new Error("Pacote de exemplos não encontrado.");
    let plain: Uint8Array;
    try {
      plain = await decrypt(await res.arrayBuffer(), password.trim());
    } catch {
      throw new Error("Senha incorreta.");
    }
    const zip = await JSZip.loadAsync(plain);
    const manifest = JSON.parse(await zip.file("exemplos.json")!.async("string")) as {
      modelo?: string;
      projetos?: { arquivo: string; cliente?: string; local?: string; area?: number }[];
      modelosClientes?: { arquivo: string; nome: string; cliente: string; orcamento?: string }[];
    };
    const read = (n: string) => zip.file(`arquivos/${n}`)?.async("uint8array");
    if (manifest.modelo) {
      const m = await read(manifest.modelo);
      if (m) await idb.set(BASE_MODEL, m);
    }
    const already = await idb.values<AnyProject>("projeto:");
    if (!already.length) {
      for (const p of manifest.projetos ?? []) {
        const b = await read(p.arquivo);
        if (b) await importBytes(b, p.arquivo, { client: p.cliente, location: p.local, area: p.area });
      }
      for (const m of manifest.modelosClientes ?? []) {
        const b = await read(m.arquivo);
        if (!b) continue;
        const t = await createTemplate(b, m.arquivo, m.nome, m.cliente);
        if (m.orcamento) await createClient(t.id, { name: m.orcamento, client: m.cliente });
      }
    }
    await idb.set("meta:liberado", true);
  },
  /** Volta para a capa (os orçamentos continuam salvos neste navegador). */
  async lock() {
    await idb.set("meta:liberado", false);
  },
};
