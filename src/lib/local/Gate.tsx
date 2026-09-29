import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Loader2, Lock, ShieldCheck } from "lucide-react";
import "@fontsource/cormorant-garamond/latin-500.css";
import "@fontsource/cormorant-garamond/latin-500-italic.css";
import { gate } from "./localApi";

// A cena 3D só é baixada quando a capa aparece (não pesa no restante da ferramenta).
const Scene3D = lazy(() => import("../../components/cover/Scene3D"));

/** Capa de acesso da versão online: showroom 3D + senha que abre as planilhas de exemplo. */
export function Gate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "locked" | "opening" | "leaving" | "open">("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [no3d, setNo3d] = useState(false);

  useEffect(() => {
    (async () => {
      if (await gate.unlocked()) return setState("open");
      setState((await gate.hasPackage()) ? "locked" : "open");
    })().catch(() => setState("locked"));
  }, []);

  if (state === "open") return <>{children}</>;
  if (state === "checking") return <div className="lux" />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setError("");
    setState("opening");
    try {
      await gate.unlock(password);
      setState("leaving");
      setTimeout(() => setState("open"), 750);
    } catch (err) {
      setError((err as Error).message);
      setState("locked");
    }
  };

  return (
    <div className={`lux ${state === "leaving" ? "leaving" : ""} ${no3d ? "no3d" : ""}`}>
      {!no3d && (
        <Suspense fallback={null}>
          <Scene3D onError={() => setNo3d(true)} />
        </Suspense>
      )}
      <div className="lux-shade" />

      <header className="lux-top">
        <span className="lux-mono">E</span>
        <span>Excelência</span>
        <span className="lux-dot" />
        <span className="lux-muted">Orçamentos de arquitetura</span>
      </header>

      <section className="lux-hero">
        <div className="lux-rule" />
        <h1>
          Do projeto
          <br />
          <em>ao orçamento,</em>
          <br />
          com excelência.
        </h1>
        <p>Preenchimento guiado, câmbio automático e apresentação pronta para o cliente — direto nas planilhas da obra.</p>
      </section>

      <form className="lux-card" onSubmit={submit}>
        <div className="lux-eyebrow">Área restrita</div>
        <h2>Boas-vindas</h2>
        <p className="lux-sub">Digite a senha de acesso que você recebeu para abrir os orçamentos.</p>
        <label className="lux-label" htmlFor="lux-pass">
          Senha de acesso
        </label>
        <div className="lux-input-wrap">
          <Lock size={16} />
          <input
            id="lux-pass"
            className="lux-input"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
            disabled={state !== "locked"}
            aria-invalid={!!error}
            aria-describedby="lux-err"
          />
        </div>
        <button className="lux-btn" disabled={!password.trim() || state !== "locked"}>
          {state === "opening" || state === "leaving" ? (
            <>
              <Loader2 size={17} className="spin" /> Preparando os orçamentos…
            </>
          ) : (
            <>
              Entrar <ArrowRight size={17} />
            </>
          )}
        </button>
        <div id="lux-err" className="lux-err" role="alert">
          {error}
        </div>
        <div className="lux-note">
          <ShieldCheck size={14} />
          <span>Os orçamentos ficam salvos somente neste navegador.</span>
        </div>
      </form>

      <footer className="lux-caption">Showroom conceito · cena 3D em tempo real</footer>
    </div>
  );
}
