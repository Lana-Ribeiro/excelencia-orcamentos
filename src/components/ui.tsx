import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function Modal({
  title,
  subtitle,
  children,
  footer,
  onClose,
  wide,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h2 className="h2">{title}</h2>
            {subtitle && <div className="muted small" style={{ marginTop: 4 }}>{subtitle}</div>}
          </div>
          <button className="btn ghost sm icon" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm";
}) {
  return (
    <div className="segmented" role="tablist" style={size === "sm" ? { padding: 2 } : undefined}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} title={o.title} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Menu suspenso ancorado a um botão. */
export function Menu({
  trigger,
  children,
  align = "left",
  width,
}: {
  trigger: (props: { onClick: (e: React.MouseEvent) => void; "aria-expanded": boolean }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (pop.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !pop.current) return;
    const r = anchor.current.getBoundingClientRect();
    const pw = pop.current.offsetWidth;
    const ph = pop.current.offsetHeight;
    let left = align === "right" ? r.right - pw : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    setPos({ top, left });
  }, [open, align]);
  return (
    <>
      {trigger({
        onClick: (e) => {
          anchor.current = e.currentTarget as HTMLElement;
          setOpen((o) => !o);
        },
        "aria-expanded": open,
      })}
      {open &&
        createPortal(
          <div ref={pop} className="popover" style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}>
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Tooltip flutuante simples para gráficos. */
export function useFloatingTip() {
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const node = tip
    ? createPortal(
        <div className="vtip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 260), top: tip.y + 14 }}>
          {tip.content}
        </div>,
        document.body,
      )
    : null;
  return {
    node,
    show: (e: React.MouseEvent, content: ReactNode) => setTip({ x: e.clientX, y: e.clientY, content }),
    hide: () => setTip(null),
  };
}

/** Renderizador mínimo de Markdown (títulos, listas, negrito, itálico). */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  const flush = () => {
    if (list) {
      out.push(list.ordered ? <ol key={out.length}>{list.items}</ol> : <ul key={out.length}>{list.items}</ul>);
      list = null;
    }
  };
  const inline = (s: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
    return parts.map((p, i) =>
      p.startsWith("**") && p.endsWith("**") ? (
        <b key={i}>{p.slice(2, -2)}</b>
      ) : p.startsWith("*") && p.endsWith("*") && p.length > 2 ? (
        <i key={i}>{p.slice(1, -1)}</i>
      ) : p.startsWith("`") && p.endsWith("`") ? (
        <code key={i}>{p.slice(1, -1)}</code>
      ) : (
        p
      ),
    );
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^\s*[-•*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push(<h3 key={out.length}>{inline(h[2])}</h3>);
    } else if (ul || ol) {
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push(<li key={list.items.length}>{inline((ul ?? ol)![1])}</li>);
    } else if (!line.trim()) {
      flush();
    } else {
      flush();
      out.push(<p key={out.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <>{out}</>;
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon-wrap">{icon}</div>
      <div className="h3" style={{ fontSize: 15 }}>{title}</div>
      {children && <div className="muted" style={{ marginTop: 6, maxWidth: 420, marginInline: "auto" }}>{children}</div>}
    </div>
  );
}

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
