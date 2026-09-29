// Monta a pasta "hf-space/" para um Space ESTÁTICO do Hugging Face (gratuito).
//
//   npm run preparar-hf
//
// A versão online roda inteira no navegador (sem servidor): cada pessoa tem os
// orçamentos salvos no próprio navegador e o Excel é gerado no download. As planilhas
// de exemplo vão num pacote criptografado (exemplos.enc) que só abre com a senha.
//
// Tudo fica numa pasta plana (sem subpastas), para arrastar de uma vez no upload:
//   README.md                       configuração do Space (sdk: static)
//   index.html, *.js, *.css, *.woff2 interface
//   exemplos.enc                    planilhas de exemplo criptografadas
//
// A senha fica em SENHA-HUGGINGFACE.txt (fora da pasta enviada). Rodar de novo
// reaproveita a mesma senha.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build as viteBuild } from "vite";
import { buildSeedZip, type SeedManifest } from "../server/seed.ts";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "hf-space");
const PASS_FILE = path.join(ROOT, "SENHA-HUGGINGFACE.txt");

function readPassword() {
  if (process.env.SENHA?.trim()) return process.env.SENHA.trim();
  if (fs.existsSync(PASS_FILE)) {
    const m = /SENHA_ACESSO=(\S+)/.exec(fs.readFileSync(PASS_FILE, "utf8"));
    if (m) return m[1];
  }
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const pick = (n: number) => Array.from(crypto.randomBytes(n), (b) => alphabet[b % alphabet.length]).join("");
  return `excelencia-${pick(4)}-${pick(4)}-${pick(4)}`;
}

/** Mesmo formato que o navegador abre com WebCrypto (src/lib/local/localApi.ts). */
function encryptForBrowser(plain: Buffer, password: string) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, 250000, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([Buffer.from("EXC2"), salt, iv, data]);
}

const password = readPassword();
// esvazia a pasta (em vez de apagá-la: ela pode estar aberta no Explorer)
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f), { recursive: true, force: true });

// 1) interface no modo estático
console.log("• Compilando a versão online…");
const webTmp = fs.mkdtempSync(path.join(os.tmpdir(), "excelencia-web-"));
await viteBuild({
  logLevel: "warn",
  base: "./",
  define: { "import.meta.env.VITE_ESTATICO": JSON.stringify("1") },
  build: { outDir: webTmp, assetsDir: "", emptyOutDir: true },
});
for (const f of fs.readdirSync(webTmp)) {
  const src = path.join(webTmp, f);
  if (fs.statSync(src).isDirectory()) throw new Error(`Esperava arquivos soltos, achei a pasta ${f}`);
  fs.copyFileSync(src, path.join(OUT, f));
}
fs.rmSync(webTmp, { recursive: true, force: true });

// 2) exemplos criptografados
console.log("• Criptografando as planilhas de exemplo…");
const manifestFile = path.join(ROOT, "exemplos.local.json");
const manifest: SeedManifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : { modelo: "Planilha modelo.xlsm" };
const zip = await buildSeedZip(manifest, (n) => (fs.existsSync(path.join(ROOT, n)) ? fs.readFileSync(path.join(ROOT, n)) : null));
fs.writeFileSync(path.join(OUT, "exemplos.enc"), encryptForBrowser(zip, password));

// 3) configuração do Space
fs.writeFileSync(
  path.join(OUT, "README.md"),
  `---
title: Excelência Orçamentos
emoji: 📐
colorFrom: gray
colorTo: blue
sdk: static
pinned: false
---

Ferramenta de orçamentos de obra com preenchimento guiado e planilhas Excel (versão de demonstração). Acesso com senha.
`,
);

fs.writeFileSync(
  PASS_FILE,
  `Senha da versão online (NÃO envie este arquivo para o Hugging Face)

SENHA_ACESSO=${password}

Envie para a arquiteta o link do Space e esta senha.
A senha abre as planilhas de exemplo, que vão criptografadas no arquivo exemplos.enc.
`,
);

const files = fs.readdirSync(OUT).map((f) => `  ${f.padEnd(52)} ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0).padStart(6)} KB`);
console.log(`\nPronto: ${OUT}\n${files.join("\n")}\n\nSenha salva em ${PASS_FILE}`);
