// Armazenamento: cada orçamento é uma pasta com o arquivo Excel (a base de dados) e um
// projeto.json com o que a planilha não comporta (especificações estruturadas, moeda
// original digitada, preferências). O Excel é regravado a cada alteração e, se for
// editado por fora, é reimportado automaticamente ao abrir.

import fs from "node:fs";
import path from "node:path";
import { Workbook } from "./xlsx/workbook.ts";
import { isTopsiteWorkbook, parseTopsite, writeTopsite } from "./topsite.ts";
import { detectTemplate, writeClient } from "./clientTemplate.ts";
import { commentsForExcel, computeBudget, flatten, uid } from "../shared/calc.ts";
import type { EvalCell } from "../shared/formula.ts";
import { clientTotal, summarizeProject } from "../shared/summary.ts";
import type {
  AnyProject,
  BudgetNode,
  ClientColumns,
  ClientProject,
  ClientTemplate,
  CurrencyCode,
  ProjectSummary,
  TopsiteProject,
} from "../shared/types.ts";

export const ROOT = process.cwd();
export const DATA = path.resolve(process.env.DATA_DIR ?? path.join(ROOT, "data"));
const MODEL_DIR = path.join(DATA, "modelo");
const PROJECTS = path.join(DATA, "projetos");
const TEMPLATES = path.join(DATA, "modelos-clientes");
const TRASH = path.join(DATA, "lixeira");
export const BASE_MODEL = path.join(MODEL_DIR, "Planilha modelo.xlsm");

for (const d of [DATA, MODEL_DIR, PROJECTS, TEMPLATES]) fs.mkdirSync(d, { recursive: true });

const now = () => new Date().toISOString();
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file: string, data: unknown) => {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
};

export function safeFileName(s: string) {
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

function projectDir(id: string) {
  if (!/^[\w-]+$/.test(id)) throw new Error("id inválido");
  return path.join(PROJECTS, id);
}
function templateDir(id: string) {
  if (!/^[\w-]+$/.test(id)) throw new Error("id inválido");
  return path.join(TEMPLATES, id);
}

// ---------------- fila de gravação no Excel (uma por projeto) ----------------
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(job);
  queues.set(key, next.finally(() => queues.get(key) === next && queues.delete(key)));
  return next;
}

function busyMessage(err: unknown) {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "EBUSY" || code === "EPERM" || code === "EACCES")
    return "O arquivo Excel está aberto em outro programa. As alterações ficaram salvas na ferramenta e serão gravadas quando ele for fechado.";
  return (err as Error)?.message ?? String(err);
}

// ---------------- projetos ----------------

export function listProjects(): ProjectSummary[] {
  const out: ProjectSummary[] = [];
  for (const id of fs.readdirSync(PROJECTS)) {
    const file = path.join(PROJECTS, id, "projeto.json");
    if (!fs.existsSync(file)) continue;
    try {
      const p = readJson<AnyProject>(file);
      out.push(summarize(p));
    } catch {
      /* ignora pastas corrompidas */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function summarize(p: AnyProject): ProjectSummary {
  let tpl: ReturnType<typeof getTemplate> | null = null;
  if (p.kind === "client") {
    try {
      tpl = getTemplate(p.templateId);
    } catch {
      /* modelo removido */
    }
  }
  return summarizeProject(p, tpl);
}

export { clientTotal };

export async function createTopsiteProject(input: { name: string; client?: string; company?: string; display?: CurrencyCode; rate?: number }) {
  if (!fs.existsSync(BASE_MODEL)) throw new Error("A planilha modelo não foi encontrada em data/modelo/.");
  const buf = fs.readFileSync(BASE_MODEL);
  const wb = await Workbook.load(buf);
  const parsed = await parseTopsite(wb);
  const id = uid("p");
  const dir = projectDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const excelFile = `TOPSITE_PROPOSAL_${safeFileName(input.name).toUpperCase()}_R00.xlsm`;
  fs.writeFileSync(path.join(dir, excelFile), buf);
  const project: TopsiteProject = {
    ...parsed.project,
    id,
    info: {
      ...parsed.project.info,
      name: input.name,
      client: input.client,
      company: input.company?.trim() || "TOPSITE ENGINEERING",
      date: new Date().toISOString().slice(0, 10),
      revision: "R00",
    },
    roots: [{ id: uid(), level: 1, description: input.name.toUpperCase(), children: [] }],
    currency: {
      ...parsed.project.currency,
      display: input.display ?? "BRL",
      ...(input.display && input.display !== "BRL" && input.rate ? { foreign: input.display, rate: input.rate, mode: "live" as const, rateAt: now() } : {}),
    },
    warnings: parsed.project.warnings,
    createdAt: now(),
    updatedAt: now(),
    sync: { excelFile, lastRow: parsed.lastUsedRow },
  };
  writeJson(path.join(dir, "projeto.json"), project);
  await syncExcel(project);
  return project;
}

export async function importWorkbook(buf: Buffer, fileName: string, meta: { name?: string; client?: string } = {}) {
  const wb = await Workbook.load(buf);
  if (isTopsiteWorkbook(wb)) {
    const parsed = await parseTopsite(wb);
    const id = uid("p");
    const dir = projectDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const excelFile = safeFileName(fileName.replace(/\.(xlsm|xlsx)$/i, "")) + path.extname(fileName).toLowerCase();
    fs.writeFileSync(path.join(dir, excelFile), buf);
    const project: TopsiteProject = {
      ...parsed.project,
      id,
      info: { ...parsed.project.info, client: meta.client ?? parsed.project.info.client },
      createdAt: now(),
      updatedAt: now(),
      sync: { excelFile, lastExcelMtime: fs.statSync(path.join(dir, excelFile)).mtimeMs, lastRow: parsed.lastUsedRow },
    };
    writeJson(path.join(dir, "projeto.json"), project);
    return { type: "project" as const, id };
  }
  const t = await createTemplate(buf, fileName, meta.name ?? fileName.replace(/\.(xlsm|xlsx)$/i, ""), meta.client ?? "");
  return { type: "template" as const, id: t.id, warnings: t.warnings ?? [] };
}

export async function getProject(id: string): Promise<{ project: AnyProject; reimported: boolean }> {
  const dir = projectDir(id);
  const file = path.join(dir, "projeto.json");
  if (!fs.existsSync(file)) throw Object.assign(new Error("Orçamento não encontrado"), { status: 404 });
  const project = readJson<AnyProject>(file);
  if (project.kind !== "topsite" || !project.sync) return { project, reimported: false };

  // Excel editado fora da ferramenta? Reimporta mantendo o que só existe aqui.
  const excelPath = path.join(dir, project.sync.excelFile);
  if (!fs.existsSync(excelPath)) return { project, reimported: false };
  const mtime = fs.statSync(excelPath).mtimeMs;
  if (project.sync.lastExcelMtime && mtime > project.sync.lastExcelMtime + 1500) {
    try {
      const wb = await Workbook.load(fs.readFileSync(excelPath));
      const parsed = await parseTopsite(wb);
      const merged: TopsiteProject = {
        ...project,
        info: { ...project.info, ...parsed.project.info, client: project.info.client, area: project.info.area, location: project.info.location },
        params: parsed.project.params,
        currency: { ...project.currency, foreign: parsed.project.currency.foreign, rate: parsed.project.currency.rate },
        roots: mergeExtras(parsed.project.roots, project.roots),
        warnings: parsed.project.warnings,
        updatedAt: now(),
        sync: { ...project.sync, lastExcelMtime: mtime, lastRow: parsed.lastUsedRow },
      };
      writeJson(file, merged);
      return { project: merged, reimported: true };
    } catch {
      return { project, reimported: false };
    }
  }
  return { project, reimported: false };
}

/** Preserva especificações/moeda original dos itens que não mudaram no Excel. */
function mergeExtras(fresh: BudgetNode[], old: BudgetNode[]): BudgetNode[] {
  const oldLeaves = flatten(old).filter((n) => n.level === 4);
  const used = new Set<string>();
  const rec = (nodes: BudgetNode[]): BudgetNode[] =>
    nodes.map((n) => {
      if (n.level !== 4) return { ...n, children: rec(n.children ?? []) };
      const match = oldLeaves.find((o) => !used.has(o.id) && o.description === n.description);
      if (!match) return n;
      used.add(match.id);
      const out: BudgetNode = { ...n, id: match.id };
      if (commentsForExcel(match) === commentsForExcel(n)) {
        out.comments = match.comments;
        out.specs = match.specs;
      }
      if (match.foreign && match.material === n.material && match.labor === n.labor) out.foreign = match.foreign;
      return out;
    });
  return rec(fresh);
}

export async function saveProject(id: string, incoming: AnyProject) {
  const dir = projectDir(id);
  const file = path.join(dir, "projeto.json");
  if (!fs.existsSync(file)) throw Object.assign(new Error("Orçamento não encontrado"), { status: 404 });
  const current = readJson<AnyProject>(file);
  const project = { ...incoming, id, kind: current.kind, sync: current.sync, updatedAt: now() } as AnyProject;
  writeJson(file, project);
  return syncExcel(project);
}

/** Grava o Excel do projeto (serializado por projeto). */
export function syncExcel(project: AnyProject) {
  return enqueue(project.id, async () => {
    const dir = projectDir(project.id);
    const file = path.join(dir, "projeto.json");
    const latest = readJson<AnyProject>(file); // sempre grava o estado mais recente
    const sync = { ...(latest.sync ?? project.sync!) } as NonNullable<AnyProject["sync"]>;
    const excelPath = path.join(dir, sync.excelFile);
    try {
      let buf: Uint8Array;
      if (latest.kind === "topsite") {
        const wb = await Workbook.load(fs.readFileSync(excelPath));
        const { lastRow } = await writeTopsite(wb, latest, sync.lastRow ?? 437);
        buf = await wb.save();
        sync.lastRow = lastRow;
      } else {
        const { template } = getTemplate(latest.templateId);
        const wb = await Workbook.load(fs.readFileSync(path.join(templateDir(template.id), template.fileName)));
        await writeClient(wb, template, latest);
        buf = await wb.save();
      }
      const tmp = excelPath + ".tmp";
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, excelPath);
      sync.lastExcelWrite = now();
      sync.lastExcelMtime = fs.statSync(excelPath).mtimeMs;
      sync.lastError = null;
    } catch (err) {
      sync.lastError = busyMessage(err);
      try {
        fs.rmSync(excelPath + ".tmp", { force: true });
      } catch {
        /* nada */
      }
    }
    const fresh = readJson<AnyProject>(file);
    fresh.sync = sync;
    writeJson(file, fresh);
    return sync;
  });
}

export function excelPathFor(id: string) {
  const p = readJson<AnyProject>(path.join(projectDir(id), "projeto.json"));
  return { path: path.join(projectDir(id), p.sync!.excelFile), name: p.sync!.excelFile };
}

export function deleteProject(id: string) {
  const dir = projectDir(id);
  fs.mkdirSync(TRASH, { recursive: true });
  fs.renameSync(dir, path.join(TRASH, `${id}-${Date.now()}`));
}

export async function duplicateProject(id: string) {
  const { project } = await getProject(id);
  const newId = uid("p");
  const dir = projectDir(newId);
  fs.mkdirSync(dir, { recursive: true });
  const src = excelPathFor(id);
  const copy = { ...project, id: newId, createdAt: now(), updatedAt: now() } as AnyProject;
  if (copy.kind === "topsite") copy.info = { ...copy.info, name: copy.info.name + " (cópia)" };
  else copy.info = { ...copy.info, name: copy.info.name + " (cópia)" };
  fs.copyFileSync(src.path, path.join(dir, src.name));
  writeJson(path.join(dir, "projeto.json"), copy);
  return copy;
}

// ---------------- modelos de clientes ----------------

export async function createTemplate(buf: Buffer, fileName: string, name: string, client: string) {
  const wb = await Workbook.load(buf);
  const det = await detectTemplate(wb);
  const id = uid("t");
  const dir = templateDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const stored = safeFileName(fileName.replace(/\.(xlsm|xlsx)$/i, "")) + path.extname(fileName).toLowerCase();
  fs.writeFileSync(path.join(dir, stored), buf);
  const template: ClientTemplate = { ...det.template, id, name, client, fileName: stored, warnings: det.warnings, createdAt: now(), updatedAt: now() };
  writeJson(path.join(dir, "modelo.json"), template);
  writeJson(path.join(dir, "celulas.json"), det.cells);
  return template;
}

export function listTemplates(): (ClientTemplate & { projects: number })[] {
  const projects = listProjectsRaw().filter((p): p is ClientProject => p.kind === "client");
  return fs
    .readdirSync(TEMPLATES)
    .filter((id) => fs.existsSync(path.join(TEMPLATES, id, "modelo.json")))
    .map((id) => {
      const t = readJson<ClientTemplate>(path.join(TEMPLATES, id, "modelo.json"));
      return { ...t, projects: projects.filter((p) => p.templateId === id).length };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function listProjectsRaw(): AnyProject[] {
  return fs
    .readdirSync(PROJECTS)
    .map((id) => path.join(PROJECTS, id, "projeto.json"))
    .filter((f) => fs.existsSync(f))
    .map((f) => readJson<AnyProject>(f));
}

export function getTemplate(id: string) {
  const dir = templateDir(id);
  if (!fs.existsSync(path.join(dir, "modelo.json"))) throw Object.assign(new Error("Modelo não encontrado"), { status: 404 });
  return {
    template: readJson<ClientTemplate>(path.join(dir, "modelo.json")),
    cells: readJson<Record<string, EvalCell>>(path.join(dir, "celulas.json")),
  };
}

export async function updateTemplate(id: string, patch: { name?: string; client?: string; sheet?: string; headerRow?: number; columns?: ClientColumns }) {
  const { template } = getTemplate(id);
  const dir = templateDir(id);
  let next: ClientTemplate = { ...template, name: patch.name ?? template.name, client: patch.client ?? template.client, updatedAt: now() };
  if (patch.sheet || patch.headerRow || patch.columns) {
    const wb = await Workbook.load(fs.readFileSync(path.join(dir, template.fileName)));
    const det = await detectTemplate(wb, patch.sheet ?? template.sheet, {
      headerRow: patch.headerRow ?? (patch.sheet && patch.sheet !== template.sheet ? undefined : template.headerRow),
      columns: patch.columns ?? (patch.sheet && patch.sheet !== template.sheet ? undefined : template.columns),
    });
    next = { ...next, ...det.template, warnings: det.warnings };
    writeJson(path.join(dir, "celulas.json"), det.cells);
  }
  writeJson(path.join(dir, "modelo.json"), next);
  return next;
}

export function deleteTemplate(id: string) {
  const dir = templateDir(id);
  fs.mkdirSync(TRASH, { recursive: true });
  fs.renameSync(dir, path.join(TRASH, `${id}-${Date.now()}`));
}

export async function createClientProject(templateId: string, input: { name: string; client?: string; display?: CurrencyCode; rate?: number }) {
  const { template } = getTemplate(templateId);
  const id = uid("p");
  const dir = projectDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(template.fileName) || ".xlsx";
  const excelFile = `${safeFileName(input.name)}${ext}`;
  fs.copyFileSync(path.join(templateDir(templateId), template.fileName), path.join(dir, excelFile));
  const project: ClientProject = {
    id,
    kind: "client",
    templateId,
    info: { name: input.name, client: input.client ?? template.client, revision: "R00" },
    values: {},
    currency: {
      display: input.display ?? "BRL",
      foreign: input.display && input.display !== "BRL" ? input.display : "USD",
      rate: input.rate ?? 5.2,
      mode: "live",
    },
    createdAt: now(),
    updatedAt: now(),
    sync: { excelFile },
  };
  writeJson(path.join(dir, "projeto.json"), project);
  await syncExcel(project);
  return project;
}

/** Complementa as informações de um orçamento criado a partir de um exemplo. */
export function patchProjectInfo(id: string, info: Partial<TopsiteProject["info"]>) {
  const file = path.join(projectDir(id), "projeto.json");
  const p = readJson<TopsiteProject>(file);
  if (p.kind !== "topsite") return;
  p.info = { ...p.info, ...Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined && v !== null)) };
  writeJson(file, p);
}
