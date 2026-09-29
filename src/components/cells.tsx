import { useEffect, useRef, useState } from "react";
import { parseNumberInput } from "../../shared/calc";
import { num } from "../../shared/format";
import type { CurrencyCode } from "../../shared/types";

const CURRENCY_TOKENS: [RegExp, CurrencyCode][] = [
  [/(ar\$|\bars\b)/i, "ARS"],
  [/(cl\$|\bclp\b)/i, "CLP"],
  [/(mx\$|\bmxn\b)/i, "MXN"],
  [/(col\$|\bcop\b)/i, "COP"],
  [/(uy\$|\buyu\b)/i, "UYU"],
  [/(₲|\bpyg\b)/i, "PYG"],
  [/(s\/|\bpen\b)/i, "PEN"],
  [/(€|\beur\b|euro)/i, "EUR"],
  [/(r\$|\bbrl\b|reais)/i, "BRL"], // antes do "$" genérico
  [/(us\$|u\$s|\busd\b|d[oó]lar|\$)/i, "USD"],
];

export interface NumberCommit {
  value: number | null;
  expr?: string;
  foreign?: { currency: CurrencyCode; amount: number; rate: number };
}

/** Interpreta "120 usd", "US$ 1.200,50", "135,4*1,2" etc. */
export function parseMoneyInput(raw: string, rateOf?: (c: CurrencyCode) => number): NumberCommit | "invalid" {
  const text = raw.trim();
  if (!text) return { value: null };
  let currency: CurrencyCode = "BRL";
  let rest = text;
  if (rateOf) {
    for (const [re, code] of CURRENCY_TOKENS) {
      if (re.test(rest)) {
        currency = code;
        rest = rest.replace(re, "");
        break;
      }
    }
  }
  const parsed = parseNumberInput(rest);
  if (!parsed) return "invalid";
  if (currency !== "BRL" && rateOf) {
    const rate = rateOf(currency);
    if (!rate) return "invalid";
    return { value: Math.round(parsed.value * rate * 100) / 100, foreign: { currency, amount: parsed.value, rate } };
  }
  return { value: parsed.value, expr: parsed.expr };
}

export function NumberCell({
  value,
  expr,
  onCommit,
  decimals = 2,
  placeholder,
  nav,
  rateOf,
  className = "",
  ariaLabel,
  badge,
  disabled,
}: {
  value: number | null | undefined;
  expr?: string;
  onCommit: (c: NumberCommit) => void;
  decimals?: number;
  placeholder?: string;
  nav?: string;
  rateOf?: (c: CurrencyCode) => number;
  className?: string;
  ariaLabel?: string;
  badge?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const display = value === null || value === undefined ? "" : num(value, decimals);

  useEffect(() => {
    if (!editing) setInvalid(false);
  }, [editing]);

  const commit = () => {
    const raw = text;
    const current = expr ? "=" + expr.replace(/\./g, ",") : value === null || value === undefined ? "" : String(value).replace(".", ",");
    if (raw.trim() === current.trim()) return true;
    const r = parseMoneyInput(raw, rateOf);
    if (r === "invalid") {
      setInvalid(true);
      return false;
    }
    onCommit(r);
    return true;
  };

  return (
    <div className="cellwrap">
      {!editing && expr && <span className="fx" title={`Fórmula: =${expr}`}>fx</span>}
      {!editing && badge && <span className="fxc">{badge}</span>}
      <input
        ref={ref}
        className={`cell r ${className} ${invalid ? "invalid" : ""} ${!editing && (expr || badge) ? "hasfx" : ""}`}
        value={editing ? text : display}
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-nav={nav}
        disabled={disabled}
        inputMode="decimal"
        onFocus={(e) => {
          setEditing(true);
          setText(expr ? "=" + expr.replace(/\./g, ",") : value === null || value === undefined ? "" : String(value).replace(".", ","));
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        onBlur={() => {
          if (commit()) setEditing(false);
          else setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (commit()) {
              setEditing(false);
              focusNext(e.currentTarget, e.shiftKey ? -1 : 1);
            }
          } else if (e.key === "Escape") {
            setEditing(false);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (commit()) {
              setEditing(false);
              focusNext(e.currentTarget, e.key === "ArrowDown" ? 1 : -1);
            }
          }
        }}
      />
    </div>
  );
}

export function TextCell({
  value,
  onCommit,
  placeholder,
  nav,
  className = "",
  list,
  ariaLabel,
  autoFocus,
}: {
  value: string | undefined;
  onCommit: (v: string) => void;
  placeholder?: string;
  nav?: string;
  className?: string;
  list?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value ?? "");
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value ?? "");
  }, [value]);
  const commit = () => {
    if ((value ?? "") !== text) onCommit(text);
  };
  return (
    <input
      className={`cell ${className}`}
      value={text}
      placeholder={placeholder}
      data-nav={nav}
      list={list}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onFocus={(e) => {
        focused.current = true;
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          focusNext(e.currentTarget, e.shiftKey ? -1 : 1);
        } else if (e.key === "Escape") {
          setText(value ?? "");
          focused.current = false;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** Texto que quebra linha e cresce com o conteúdo (descrições longas). */
export function TextAreaCell({
  value,
  onCommit,
  placeholder,
  nav,
  className = "",
  ariaLabel,
  autoFocus,
}: {
  value: string | undefined;
  onCommit: (v: string) => void;
  placeholder?: string;
  nav?: string;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value ?? "");
  const focused = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focused.current) setText(value ?? "");
  }, [value]);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.max(30, el.scrollHeight) + "px";
  };
  useEffect(fit, [text]);
  useEffect(() => {
    const on = () => fit();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const commit = () => {
    const clean = text.replace(/\s*\n\s*/g, " ").trim();
    if ((value ?? "") !== clean) onCommit(clean);
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      className={`cell area ${className}`}
      value={text}
      placeholder={placeholder}
      data-nav={nav}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          focusNext(e.currentTarget, e.shiftKey ? -1 : 1);
        } else if (e.key === "Escape") {
          setText(value ?? "");
          focused.current = false;
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

export function focusNext(el: HTMLElement, dir: 1 | -1) {
  const nav = el.getAttribute("data-nav");
  if (!nav) return;
  const all = [...document.querySelectorAll<HTMLInputElement>(`[data-nav="${nav}"]`)];
  const i = all.indexOf(el as HTMLInputElement);
  const next = all[i + dir];
  if (next) next.focus();
  else el.blur();
}
