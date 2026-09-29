// Dados de exemplo da primeira execução.
//
// Local: lidos de "exemplos.local.json" + planilhas na pasta da ferramenta.
// Nuvem: lidos de "exemplos.enc" — um pacote criptografado (AES-256-GCM) com a
// senha de acesso (SENHA_ACESSO). Assim as planilhas podem ficar num repositório
// público sem que ninguém consiga abri-las sem a senha.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { BASE_MODEL, DATA, ROOT, createClientProject, createTemplate, importWorkbook, patchProjectInfo } from "./store.ts";

export interface SeedManifest {
  modelo?: string; // planilha modelo da empresa (novos orçamentos)
  projetos?: { arquivo: string; cliente?: string; local?: string; area?: number }[];
  modelosClientes?: { arquivo: string; nome: string; cliente: string; orcamento?: string }[];
}

type FileSource = (name: string) => Buffer | null;

// ---------- criptografia do pacote ----------
const MAGIC = Buffer.from("EXC1");

export function encryptPackage(plain: Buffer, password: string) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), data]);
}

export function decryptPackage(buf: Buffer, password: string) {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error("pacote de exemplos inválido");
  const salt = buf.subarray(4, 20);
  const iv = buf.subarray(20, 32);
  const tag = buf.subarray(32, 48);
  const key = crypto.scryptSync(password, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buf.subarray(48)), decipher.final()]);
}

/** Monta o zip (manifesto + planilhas) que vai criptografado para a nuvem. */
export async function buildSeedZip(manifest: SeedManifest, read: FileSource) {
  const zip = new JSZip();
  zip.file("exemplos.json", JSON.stringify(manifest, null, 1));
  const names = [manifest.modelo, ...(manifest.projetos ?? []).map((p) => p.arquivo), ...(manifest.modelosClientes ?? []).map((m) => m.arquivo)].filter(Boolean) as string[];
  for (const n of names) {
    const b = read(n);
    if (!b) throw new Error(`Arquivo de exemplo não encontrado: ${n}`);
    zip.file(`arquivos/${n}`, b);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function loadSources(): Promise<{ manifest: SeedManifest; read: FileSource } | null> {
  const encFile = path.join(ROOT, "exemplos.enc");
  const password = process.env.SENHA_ACESSO?.trim();
  if (fs.existsSync(encFile) && password) {
    const zip = await JSZip.loadAsync(decryptPackage(fs.readFileSync(encFile), password));
    const manifest = JSON.parse(await zip.file("exemplos.json")!.async("string")) as SeedManifest;
    const files = new Map<string, Buffer>();
    for (const [name, entry] of Object.entries(zip.files)) if (name.startsWith("arquivos/") && !entry.dir) files.set(name.slice(9), await entry.async("nodebuffer"));
    return { manifest, read: (n) => files.get(n) ?? null };
  }
  const localManifest = path.join(ROOT, "exemplos.local.json");
  if (fs.existsSync(localManifest)) {
    const manifest = JSON.parse(fs.readFileSync(localManifest, "utf8")) as SeedManifest;
    return { manifest, read: (n) => (fs.existsSync(path.join(ROOT, n)) ? fs.readFileSync(path.join(ROOT, n)) : null) };
  }
  return null;
}

export async function seedIfEmpty() {
  const marker = path.join(DATA, ".iniciado");
  let sources: Awaited<ReturnType<typeof loadSources>> = null;
  try {
    sources = await loadSources();
  } catch (err) {
    console.error("Não foi possível abrir os exemplos (senha diferente da usada no pacote?):", (err as Error).message);
  }
  const { manifest, read } = sources ?? { manifest: {} as SeedManifest, read: (() => null) as FileSource };

  if (!fs.existsSync(BASE_MODEL)) {
    const model = (manifest.modelo && read(manifest.modelo)) || (fs.existsSync(path.join(ROOT, "Planilha modelo.xlsm")) ? fs.readFileSync(path.join(ROOT, "Planilha modelo.xlsm")) : null);
    if (model) fs.writeFileSync(BASE_MODEL, model);
  }
  if (fs.existsSync(marker) || !sources) return;

  try {
    for (const p of manifest.projetos ?? []) {
      const buf = read(p.arquivo);
      if (!buf) continue;
      const r = await importWorkbook(buf, p.arquivo, { client: p.cliente });
      if (r.type === "project") patchProjectInfo(r.id, { client: p.cliente, location: p.local, area: p.area });
    }
    for (const m of manifest.modelosClientes ?? []) {
      const buf = read(m.arquivo);
      if (!buf) continue;
      const t = await createTemplate(buf, m.arquivo, m.nome, m.cliente);
      if (m.orcamento) await createClientProject(t.id, { name: m.orcamento, client: m.cliente });
    }
  } catch (err) {
    console.error("Falha ao criar exemplos:", err);
  }
  fs.writeFileSync(marker, new Date().toISOString());
}
