import fs from "node:fs";
import path from "node:path";

// Carrega o .env (sem dependências) antes de qualquer outro módulo usar process.env.
const envFile = path.resolve(".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const express = (await import("express")).default;
const store = await import("./store.ts");
const { seedIfEmpty } = await import("./seed.ts");
const { getRates } = await import("./fx.ts");
const ai = await import("./ai.ts");
const { authGate, loginRoute } = await import("./auth.ts");

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "40mb" }));
// Senha de acesso (ativa quando SENHA_ACESSO estiver definida — ex.: na nuvem)
app.post("/api/login", loginRoute);
app.use(authGate);

type Handler = (req: import("express").Request, res: import("express").Response) => Promise<unknown> | unknown;
const route = (fn: Handler) => async (req: import("express").Request, res: import("express").Response) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    if (!res.headersSent) res.status(status).json({ error: (err as Error).message ?? String(err) });
  }
};

app.get("/api/health", route(() => ({ ok: true, ai: ai.aiStatus() })));

app.get("/api/fx", route(async (req) => getRates(req.query.force === "1")));

// ---------- orçamentos ----------
app.get("/api/projects", route(() => store.listProjects()));

app.post(
  "/api/projects",
  route(async (req) => {
    const b = req.body ?? {};
    if (!b.name?.trim()) throw new Error("Informe o nome do orçamento.");
    if (b.kind === "client") return store.createClientProject(b.templateId, b);
    return store.createTopsiteProject(b);
  }),
);

app.get(
  "/api/projects/:id",
  route(async (req) => {
    const { project, reimported } = await store.getProject(req.params.id as string);
    const extra = project.kind === "client" ? store.getTemplate(project.templateId) : null;
    return { project, reimported, template: extra?.template, cells: extra?.cells };
  }),
);

app.put("/api/projects/:id", route(async (req) => ({ sync: await store.saveProject(req.params.id as string, req.body) })));

app.post("/api/projects/:id/duplicate", route(async (req) => store.duplicateProject(req.params.id as string)));

app.delete(
  "/api/projects/:id",
  route((req) => {
    store.deleteProject(req.params.id as string);
    return { ok: true };
  }),
);

app.get(
  "/api/projects/:id/excel",
  route(async (req, res) => {
    const f = store.excelPathFor(req.params.id as string);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader("Content-Type", f.name.endsWith(".xlsm") ? "application/vnd.ms-excel.sheet.macroEnabled.12" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(fs.readFileSync(f.path));
  }),
);

// ---------- importação (arquivo bruto) ----------
app.post(
  "/api/import",
  express.raw({ type: "*/*", limit: "80mb" }),
  route(async (req) => {
    const name = decodeURIComponent(String(req.headers["x-file-name"] ?? "planilha.xlsx"));
    if (!/\.(xlsx|xlsm)$/i.test(name)) throw new Error("Envie um arquivo .xlsx ou .xlsm.");
    return store.importWorkbook(req.body as Buffer, name, {
      name: req.headers["x-template-name"] ? decodeURIComponent(String(req.headers["x-template-name"])) : undefined,
      client: req.headers["x-client"] ? decodeURIComponent(String(req.headers["x-client"])) : undefined,
    });
  }),
);

// ---------- modelos de clientes ----------
app.get("/api/templates", route(() => store.listTemplates()));
app.get("/api/templates/:id", route((req) => store.getTemplate(req.params.id as string)));
app.put("/api/templates/:id", route(async (req) => store.updateTemplate(req.params.id as string, req.body ?? {})));
app.delete(
  "/api/templates/:id",
  route((req) => {
    store.deleteTemplate(req.params.id as string);
    return { ok: true };
  }),
);

// ---------- IA ----------
app.post(
  "/api/ai/chat",
  route(async (req, res) => {
    const { projectId, project: draft, history = [], message = "", attachments = [] } = req.body ?? {};
    const { project: saved } = await store.getProject(projectId);
    const project = draft && draft.id === saved.id ? draft : saved; // estado atual da tela
    const template = project.kind === "client" ? store.getTemplate(project.templateId) : undefined;
    const { rates } = await getRates();
    await ai.streamChat(res, { project, template, history, message, attachments, rates });
  }),
);

app.post(
  "/api/ai/insights",
  route(async (req, res) => {
    const { project, metrics = "" } = req.body ?? {};
    if (project?.kind !== "topsite") throw new Error("Análise disponível para orçamentos no modelo da empresa.");
    const { rates } = await getRates();
    await ai.streamInsights(res, { project, rates, metrics });
  }),
);

// ---------- interface ----------
const dist = path.resolve(process.env.STATIC_DIR ?? "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

await seedIfEmpty();
const port = Number(process.env.EXCELENCIA_PORT) || 5180;
app.listen(port, () => {
  const status = ai.aiStatus();
  console.log(`\n  Excelência · Orçamentos  →  http://localhost:${port}`);
  console.log(`  Dados em: ${store.DATA}`);
  console.log(`  Assistente de IA: ${status.configured ? `ativo (${status.model})` : "sem chave (ANTHROPIC_API_KEY) — veja o README"}\n`);
  if (process.env.ABRIR_NAVEGADOR === "1") {
    const url = `http://localhost:${port}`;
    const cmd = process.platform === "win32" ? `start "" ${url}` : process.platform === "darwin" ? `open ${url}` : `xdg-open ${url}`;
    import("node:child_process").then(({ exec }) => exec(cmd));
  }
});
