// Senha de acesso única para uso na nuvem. Ativa somente quando SENHA_ACESSO está
// definida; localmente (sem a variável) a ferramenta abre direto.

import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE = "exc_sessao";
const password = () => process.env.SENHA_ACESSO?.trim() ?? "";
const token = () => crypto.createHmac("sha256", password()).update("excelencia-sessao-v1").digest("hex");

function cookieValue(req: Request, name: string) {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function authenticated(req: Request) {
  const got = cookieValue(req, COOKIE);
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(token());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function loginRoute(req: Request, res: Response) {
  if (!password()) return res.json({ ok: true });
  const given = String(req.body?.senha ?? "");
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(password()).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    await new Promise((r) => setTimeout(r, 800)); // freia tentativas em sequência
    return res.status(401).json({ error: "Senha incorreta." });
  }
  // HTTPS (nuvem): cookie aceito também quando a página é aberta dentro de um iframe
  const attrs = req.secure ? "SameSite=None; Secure; Partitioned" : "SameSite=Lax";
  res.setHeader("Set-Cookie", `${COOKIE}=${token()}; Path=/; HttpOnly; Max-Age=${60 * 60 * 24 * 30}; ${attrs}`);
  res.json({ ok: true });
}

export function authGate(req: Request, res: Response, next: NextFunction) {
  if (!password() || authenticated(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Sessão expirada. Recarregue a página e entre com a senha." });
  res.status(200).type("html").send(LOGIN_PAGE);
}

const LOGIN_PAGE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Excelência · Orçamentos</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f4f0; color: #161513;
    font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif; padding: 16px; }
  .card { width: min(380px, 100%); background: #fff; border-radius: 16px; padding: 32px 28px 28px;
    box-shadow: 0 24px 60px -16px rgba(24,22,18,.25), 0 0 0 1px rgba(24,22,18,.08); }
  .mark { width: 40px; height: 40px; border-radius: 11px; background: #161513; color: #fff; display: grid; place-items: center;
    font-weight: 700; font-size: 20px; }
  h1 { font-size: 20px; letter-spacing: -0.015em; margin: 18px 0 4px; }
  p { margin: 0 0 22px; color: #8a857c; font-size: 14px; line-height: 1.5; }
  label { font-size: 12px; font-weight: 600; color: #4f4b45; display: block; margin-bottom: 6px; }
  input { width: 100%; height: 42px; border-radius: 10px; border: 1px solid rgba(24,22,18,.18); padding: 0 12px; font: inherit; outline: none; }
  input:focus { border-color: #2a78d6; box-shadow: 0 0 0 3px rgba(42,120,214,.15); }
  button { margin-top: 14px; width: 100%; height: 42px; border: 0; border-radius: 10px; background: #161513; color: #fff;
    font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .6; }
  .err { color: #c43535; font-size: 13px; margin-top: 10px; min-height: 18px; }
</style>
</head>
<body>
  <form class="card" id="f">
    <div class="mark">E</div>
    <h1>Excelência · Orçamentos</h1>
    <p>Acesso restrito. Digite a senha que você recebeu.</p>
    <label for="s">Senha</label>
    <input id="s" type="password" autocomplete="current-password" autofocus required />
    <button id="b" type="submit">Entrar</button>
    <div class="err" id="e" role="alert"></div>
  </form>
<script>
  document.getElementById("f").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var b = document.getElementById("b"), e = document.getElementById("e");
    b.disabled = true; e.textContent = "";
    try {
      var r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ senha: document.getElementById("s").value }) });
      if (r.ok) { location.reload(); return; }
      var d = await r.json().catch(function () { return {}; });
      e.textContent = d.error || "Não foi possível entrar.";
    } catch (x) { e.textContent = "Sem conexão com o servidor."; }
    b.disabled = false;
  });
</script>
</body>
</html>`;
