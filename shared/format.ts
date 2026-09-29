import type { CurrencyCode } from "./types";

export const CURRENCIES: Record<CurrencyCode, { name: string; symbol: string; locale: string; decimals: number; flag: string }> = {
  BRL: { name: "Real brasileiro", symbol: "R$", locale: "pt-BR", decimals: 2, flag: "BR" },
  USD: { name: "Dólar americano", symbol: "US$", locale: "en-US", decimals: 2, flag: "US" },
  EUR: { name: "Euro", symbol: "€", locale: "de-DE", decimals: 2, flag: "EU" },
  ARS: { name: "Peso argentino", symbol: "AR$", locale: "es-AR", decimals: 0, flag: "AR" },
  CLP: { name: "Peso chileno", symbol: "CL$", locale: "es-CL", decimals: 0, flag: "CL" },
  MXN: { name: "Peso mexicano", symbol: "MX$", locale: "es-MX", decimals: 2, flag: "MX" },
  COP: { name: "Peso colombiano", symbol: "COL$", locale: "es-CO", decimals: 0, flag: "CO" },
  UYU: { name: "Peso uruguaio", symbol: "UY$", locale: "es-UY", decimals: 2, flag: "UY" },
  PYG: { name: "Guarani paraguaio", symbol: "₲", locale: "es-PY", decimals: 0, flag: "PY" },
  PEN: { name: "Sol peruano", symbol: "S/", locale: "es-PE", decimals: 2, flag: "PE" },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

const nf = new Map<string, Intl.NumberFormat>();
function fmt(decimals: number, compact = false) {
  const key = `${decimals}-${compact}`;
  if (!nf.has(key))
    nf.set(
      key,
      new Intl.NumberFormat("pt-BR", compact
        ? { notation: "compact", maximumFractionDigits: 1 }
        : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
    );
  return nf.get(key)!;
}

/** Formata valor já convertido na moeda informada (números sempre no padrão pt-BR). */
export function money(value: number, currency: CurrencyCode = "BRL", opts: { compact?: boolean; decimals?: number } = {}) {
  const c = CURRENCIES[currency];
  const d = opts.decimals ?? c.decimals;
  const body = fmt(d, !!opts.compact).format(isFinite(value) ? value : 0);
  return `${c.symbol} ${body}`;
}

export function num(value: number | null | undefined, decimals = 2) {
  if (value === null || value === undefined || !isFinite(value)) return "";
  const rounded = Math.round(value * 10 ** decimals) / 10 ** decimals;
  const d = Number.isInteger(rounded) ? 0 : decimals;
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: decimals }).format(value);
}

export function pct(value: number, decimals = 1) {
  if (!isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

export function rateLabel(code: CurrencyCode, rate: number) {
  if (code === "BRL") return "R$ 1,00";
  const digits = rate < 0.01 ? 6 : rate < 1 ? 4 : 4;
  return `1 ${code} = R$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: digits }).format(rate)}`;
}

export function dateBR(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return d.toLocaleDateString("pt-BR");
}

export function relativeTime(iso?: string) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return "agora";
  if (diff < 3600) return `há ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.round(diff / 3600)} h`;
  if (diff < 86400 * 7) return `há ${Math.round(diff / 86400)} d`;
  return dateBR(iso);
}

/** Excel serial date ↔ ISO */
export function excelSerialToISO(serial: number) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}
export function isoToExcelSerial(iso: string) {
  const d = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round(d / 86400000 + 25569);
}
