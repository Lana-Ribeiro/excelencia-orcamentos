import { AppProvider, useApp, useRoute } from "./lib/app";
import { Home } from "./pages/Home";
import { Editor } from "./pages/Editor";
import { Presentation } from "./pages/Presentation";
import { Templates, TemplateDetail } from "./pages/Templates";
import { ClientEditor } from "./pages/ClientEditor";
import { num } from "../shared/format";
import { ESTATICO } from "./lib/api";
import { Gate } from "./lib/local/Gate";
import { gate } from "./lib/local/localApi";
import { LogOut } from "lucide-react";

function TopNav({ route }: { route: string }) {
  const { rates, ai, ratesOffline } = useApp();
  const pick = ["USD", "EUR", "ARS"].map((c) => rates.find((r) => r.code === c)).filter(Boolean);
  const section = route.startsWith("/modelos") ? "modelos" : "orcamentos";
  return (
    <nav className="topnav">
      <a className="brand" href="#/">
        <span className="brand-mark">E</span>
        <span className="brand-name">Excelência</span>
        <span className="brand-sub">Orçamentos</span>
      </a>
      <div className="navlinks">
        <a className={`navlink ${section === "orcamentos" ? "active" : ""}`} href="#/">Orçamentos</a>
        <a className={`navlink ${section === "modelos" ? "active" : ""}`} href="#/modelos">Modelos de clientes</a>
      </div>
      <div className="grow" />
      <div className="ticker" title={ratesOffline ? "Sem conexão: última cotação conhecida" : "Cotação comercial (R$ por unidade)"}>
        {pick.map((r) => (
          <span key={r!.code}>
            {r!.code} <b className="num">{num(r!.rate, r!.rate < 1 ? 5 : 4)}</b>
          </span>
        ))}
        {pick.length > 0 && <span className="sep" />}
        <span className="row" style={{ gap: 6 }}>
          <span className={`status-dot ${ai?.configured ? "" : "off"}`} /> {ESTATICO ? "Versão online" : ai?.configured ? "IA ativa" : "IA sem chave"}
        </span>
        {ESTATICO && (
          <button
            className="btn ghost sm"
            title="Sair (volta para a tela de acesso; os orçamentos continuam salvos neste navegador)"
            onClick={async () => {
              await gate.lock();
              window.location.hash = "/";
              window.location.reload();
            }}
          >
            <LogOut size={14} /> Sair
          </button>
        )}
      </div>
    </nav>
  );
}

function Routes() {
  const route = useRoute();
  const parts = route.split("/").filter(Boolean);
  let page;
  if (parts[0] === "p" && parts[1]) {
    if (parts[2] === "apresentacao") page = <Presentation id={parts[1]} />;
    else page = <Editor key={parts[1]} id={parts[1]} tab={parts[2] === "analise" ? "analise" : "planilha"} />;
  } else if (parts[0] === "c" && parts[1]) page = <ClientEditor key={parts[1]} id={parts[1]} />;
  else if (parts[0] === "modelos" && parts[1]) page = <TemplateDetail key={parts[1]} id={parts[1]} />;
  else if (parts[0] === "modelos") page = <Templates />;
  else page = <Home />;
  const presenting = parts[2] === "apresentacao";
  return (
    <div className="app">
      {!presenting && <TopNav route={route} />}
      {page}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      {ESTATICO ? (
        <Gate>
          <Routes />
        </Gate>
      ) : (
        <Routes />
      )}
    </AppProvider>
  );
}
