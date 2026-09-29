// Cotações de moedas (BRL por 1 unidade). Fonte principal: AwesomeAPI (cotação
// comercial usada no Brasil). Reserva: ExchangeRate-API. Cache de 10 minutos e
// última cotação conhecida gravada em disco para uso offline.

import fs from "node:fs";
import path from "node:path";
import { DATA } from "./store.ts";
import { CURRENCIES, CURRENCY_CODES } from "../shared/format.ts";
import type { CurrencyCode, FxRate } from "../shared/types.ts";

const CACHE_FILE = path.join(DATA, "cotacoes.json");
const TTL = 10 * 60 * 1000;
let memory: { at: number; rates: FxRate[] } | null = null;

async function fetchJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fromAwesome(codes: CurrencyCode[]): Promise<FxRate[]> {
  const settled = await Promise.allSettled(
    codes.map(async (code) => {
      const data = await fetchJson(`https://economia.awesomeapi.com.br/json/last/${code}-BRL`);
      const q = data[`${code}BRL`];
      const rate = parseFloat(q?.bid);
      if (!isFinite(rate) || rate <= 0) throw new Error("sem cotação");
      return {
        code,
        name: CURRENCIES[code].name,
        rate,
        at: q.create_date ? new Date(q.create_date.replace(" ", "T") + "-03:00").toISOString() : new Date().toISOString(),
        source: "AwesomeAPI (comercial)",
      } satisfies FxRate;
    }),
  );
  return settled.filter((s): s is PromiseFulfilledResult<FxRate> => s.status === "fulfilled").map((s) => s.value);
}

async function fromErApi(codes: CurrencyCode[]): Promise<FxRate[]> {
  const data = await fetchJson("https://open.er-api.com/v6/latest/BRL");
  const at = data.time_last_update_unix ? new Date(data.time_last_update_unix * 1000).toISOString() : new Date().toISOString();
  return codes
    .filter((c) => data.rates?.[c] > 0)
    .map((code) => ({ code, name: CURRENCIES[code].name, rate: 1 / data.rates[code], at, source: "ExchangeRate-API" }));
}

export async function getRates(force = false): Promise<{ rates: FxRate[]; offline: boolean }> {
  if (!force && memory && Date.now() - memory.at < TTL) return { rates: memory.rates, offline: false };
  const wanted: CurrencyCode[] = CURRENCY_CODES.filter((c) => c !== "BRL");
  let rates: FxRate[] = [];
  try {
    rates = await fromAwesome(wanted);
  } catch {
    /* segue para a reserva */
  }
  const missing = wanted.filter((c) => !rates.some((r) => r.code === c));
  if (missing.length) {
    try {
      rates = rates.concat(await fromErApi(missing));
    } catch {
      /* offline */
    }
  }
  if (rates.length) {
    rates.sort((a, b) => wanted.indexOf(a.code) - wanted.indexOf(b.code));
    memory = { at: Date.now(), rates };
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(memory));
    } catch {
      /* sem cache em disco */
    }
    return { rates, offline: false };
  }
  if (fs.existsSync(CACHE_FILE)) {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    return { rates: cached.rates, offline: true };
  }
  return { rates: [], offline: true };
}
