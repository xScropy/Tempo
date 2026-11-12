import * as Dlg from "@radix-ui/react-dialog";
import * as Dd from "@radix-ui/react-dropdown-menu";
import * as Cm from "@radix-ui/react-context-menu";
import * as Pop from "@radix-ui/react-popover";
import clsx from "clsx";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { fmtDuration, parseDuration } from "@/domain/dates";

export const cx = clsx;

// ---- buttons ----------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; icon?: ReactNode };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", icon, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
        size === "sm" ? "h-7 px-2 text-sm" : "h-8 px-3 text-sm",
        variant === "primary" && "bg-accent text-accent-ink hover:bg-accent/90",
        variant === "secondary" && "border border-line-strong bg-surface text-ink hover:bg-hover",
        variant === "ghost" && "text-ink-2 hover:bg-hover hover:text-ink",
        variant === "danger" && "border border-danger/40 bg-surface text-danger hover:bg-danger/10",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }>(function IconButton(
  { label, active, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:opacity-40", active && "bg-hover text-ink", className)}
    >
      {children}
    </button>
  );
});

// ---- form controls ----------------------------------------------------------

const fieldCls = "h-8 w-full rounded border border-line-strong bg-surface px-2.5 text-base text-ink placeholder:text-ink-3 transition-colors focus:border-accent disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} {...rest} className={cx(fieldCls, className)} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} {...rest} className={cx(fieldCls, "h-auto min-h-[72px] resize-y py-1.5 leading-5", className)} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cx("relative inline-block w-full", className)}>
      <select {...rest} className={cx(fieldCls, "appearance-none pr-7")}>
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-3" />
    </span>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

/** Text field that commits on blur / Enter and reverts on Escape. */
export function CommitInput({ value, onCommit, className, multiline, ...rest }: { value: string; onCommit: (v: string) => void; multiline?: boolean; className?: string; placeholder?: string; "aria-label"?: string; rows?: number }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  if (multiline) {
    return <Textarea {...rest} value={draft} className={className} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Escape" && (setDraft(value), e.currentTarget.blur())} />;
  }
  return (
    <Input
      {...rest}
      value={draft}
      className={className}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

/** Duration field: accepts "1h 30m", "90m", "1.5h", "1:30" or plain minutes. */
export function DurationInput({ value, onChange, placeholder = "e.g. 1h 30m", ...rest }: { value: number | null; onChange: (seconds: number | null) => void; placeholder?: string; "aria-label"?: string; className?: string }) {
  const [draft, setDraft] = useState(value ? fmtDuration(value) : "");
  const [bad, setBad] = useState(false);
  useEffect(() => setDraft(value ? fmtDuration(value) : ""), [value]);
  return (
    <Input
      {...rest}
      value={draft}
      placeholder={placeholder}
      aria-invalid={bad}
      className={cx(rest.className, bad && "border-danger")}
      onChange={(e) => (setDraft(e.target.value), setBad(false))}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      onBlur={() => {
        if (!draft.trim()) return value != null && onChange(null);
        const parsed = parseDuration(draft);
        if (parsed == null) return setBad(true);
        if (parsed !== value) onChange(parsed);
        setDraft(fmtDuration(parsed));
      }}
    />
  );
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; className?: string }) {
  return (
    <label className={cx("flex items-center gap-2 text-base", className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-[rgb(var(--accent))]" />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = "md" }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode; title?: string }>; size?: "sm" | "md" }) {
  return (
    <div role="tablist" className="inline-flex shrink-0 rounded border border-line-strong bg-raised p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          title={o.title}
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("inline-flex items-center gap-1.5 rounded-[3px] px-2.5 text-sm transition-colors", size === "sm" ? "h-6" : "h-7", value === o.value ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---- overlays ---------------------------------------------------------------

export function Dialog({ open, onClose, title, children, width = 480, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number; footer?: ReactNode }) {
  return (
    <Dlg.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dlg.Portal>
        <Dlg.Overlay className="fixed inset-0 z-40 bg-black/35" />
        <Dlg.Content
          aria-describedby={undefined}
          style={{ width: `min(94vw, ${width}px)` }}
          className="animate-pop fixed left-1/2 top-[12vh] z-50 flex max-h-[80vh] -translate-x-1/2 flex-col rounded-lg border border-line bg-surface shadow-pop"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <Dlg.Title className="text-base font-semibold">{title}</Dlg.Title>
            <Dlg.Close asChild>
              <IconButton label="Close">
                <X size={15} />
              </IconButton>
            </Dlg.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div>}
        </Dlg.Content>
      </Dlg.Portal>
    </Dlg.Root>
  );
}

export type MenuItem =
  | "sep"
  | { label: string; icon?: ReactNode; onSelect?: () => void; danger?: boolean; checked?: boolean; disabled?: boolean; children?: MenuItem[] };

const menuCls = "animate-pop z-50 min-w-[180px] rounded-md border border-line bg-surface p-1 shadow-pop";
const itemCls = "flex h-7 cursor-default select-none items-center gap-2 rounded px-2 text-sm outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-40";

function renderItems(items: MenuItem[], P: typeof Dd | typeof Cm): ReactNode {
  const M = P as typeof Dd;
  return items.map((it, i) => {
    if (it === "sep") return <M.Separator key={i} className="my-1 h-px bg-line" />;
    if (it.children) {
      return (
        <M.Sub key={i}>
          <M.SubTrigger className={itemCls}>
            <span className="flex w-4 justify-center text-ink-3">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            <ChevronRight size={13} className="text-ink-3" />
          </M.SubTrigger>
          <M.Portal>
            <M.SubContent className={menuCls}>{renderItems(it.children, P)}</M.SubContent>
          </M.Portal>
        </M.Sub>
      );
    }
    return (
      <M.Item key={i} disabled={it.disabled} onSelect={it.onSelect} className={cx(itemCls, it.danger && "text-danger")}>
        <span className="flex w-4 justify-center text-ink-3">{it.checked ? <Check size={13} /> : it.icon}</span>
        <span className="flex-1">{it.label}</span>
      </M.Item>
    );
  });
}

export function Menu({ trigger, items, align = "start" }: { trigger: ReactNode; items: MenuItem[]; align?: "start" | "end" }) {
  return (
    <Dd.Root>
      <Dd.Trigger asChild>{trigger}</Dd.Trigger>
      <Dd.Portal>
        <Dd.Content align={align} sideOffset={4} className={menuCls}>
          {renderItems(items, Dd)}
        </Dd.Content>
      </Dd.Portal>
    </Dd.Root>
  );
}

export function ContextMenu({ children, items }: { children: ReactNode; items: () => MenuItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Cm.Root onOpenChange={setOpen}>
      <Cm.Trigger asChild>{children}</Cm.Trigger>
      <Cm.Portal>
        <Cm.Content className={menuCls}>{open && renderItems(items(), Cm)}</Cm.Content>
      </Cm.Portal>
    </Cm.Root>
  );
}

export function Popover({ trigger, children, align = "start", open, onOpenChange }: { trigger: ReactNode; children: ReactNode; align?: "start" | "end" | "center"; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  return (
    <Pop.Root open={open} onOpenChange={onOpenChange}>
      <Pop.Trigger asChild>{trigger}</Pop.Trigger>
      <Pop.Portal>
        <Pop.Content align={align} sideOffset={4} className="animate-pop z-50 rounded-md border border-line bg-surface p-3 shadow-pop">
          {children}
        </Pop.Content>
      </Pop.Portal>
    </Pop.Root>
  );
}

// ---- display ----------------------------------------------------------------

export function Progress({ value, tone = "accent", className }: { value: number; tone?: "accent" | "warn" | "danger" | "ok"; className?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className={cx("h-1.5 overflow-hidden rounded-full bg-hover", className)}>
      <div className={cx("h-full rounded-full transition-[width] duration-300", { accent: "bg-accent", warn: "bg-warn", danger: "bg-danger", ok: "bg-ok" }[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "danger" | "ok"; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-2xs font-medium",
        { neutral: "bg-hover text-ink-2", accent: "bg-accent/10 text-accent", warn: "bg-warn/10 text-warn", danger: "bg-danger/10 text-danger", ok: "bg-ok/10 text-ok" }[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-ink-3">{icon}</div>}
      <div className="text-base font-medium">{title}</div>
      {body && <div className="mt-1 max-w-sm text-sm text-ink-2">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="no-print flex min-h-[52px] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-2">
      <div className="mr-auto min-w-0">
        <h1 className="truncate text-lg font-semibold leading-6">{title}</h1>
        {subtitle && <div className="truncate text-xs text-ink-2">{subtitle}</div>}
      </div>
      {children}
    </header>
  );
}

export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-md border border-line bg-surface", className)}>
      <div className="flex h-9 items-center justify-between border-b border-line px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="tabular truncate text-xl font-semibold leading-7">{value}</div>
      {sub && <div className="truncate text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

// ---- markdown ---------------------------------------------------------------

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[2]) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3]) out.push(<em key={k}>{m[3]}</em>);
    else if (m[4]) out.push(<code key={k} className="rounded bg-hover px-1 font-mono text-[12px]">{m[4]}</code>);
    else if (m[5]) out.push(<a key={k} href={m[6]} target="_blank" rel="noreferrer noopener" className="text-accent underline">{m[5]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Small, safe Markdown renderer (headings, lists, checkboxes, bold/italic/code, links). Builds React nodes — never raw HTML. */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`} className="my-1 list-disc space-y-0.5 pl-5">{list}</ul>);
    list = [];
  };
  source.split("\n").forEach((line, i) => {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(\[( |x)\]\s+)?(.*)$/.exec(line);
    if (li) {
      list.push(
        <li key={i} className={li[1] ? "list-none -ml-4" : undefined}>
          {li[1] && <span className="mr-1.5 font-mono text-ink-3">{li[2] === "x" ? "☑" : "☐"}</span>}
          {inline(li[3]!, `i${i}`)}
        </li>,
      );
      return;
    }
    flush();
    if (h) blocks.push(<div key={i} className={cx("mt-2 font-semibold", h[1]!.length === 1 ? "text-lg" : "text-base")}>{inline(h[2]!, `h${i}`)}</div>);
    else if (line.trim() === "") blocks.push(<div key={i} className="h-2" />);
    else blocks.push(<p key={i}>{inline(line, `p${i}`)}</p>);
  });
  flush();
  return <div className={cx("selectable text-base leading-[21px]", className)}>{blocks}</div>;
}
