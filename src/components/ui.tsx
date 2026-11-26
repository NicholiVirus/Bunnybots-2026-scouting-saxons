'use client';
/** Small UI kit (Tailwind). Mobile-first: ≥48 px tap targets, big numbers. */
import { useEffect, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'red' | 'blue' | 'good';
export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg' }) {
  const v: Record<BtnVariant, string> = {
    primary: 'bg-saxon text-saxon-ink hover:brightness-110 font-semibold',
    secondary: 'bg-surface-2 text-fg border border-line hover:brightness-110',
    ghost: 'bg-transparent text-fg hover:bg-surface-2',
    danger: 'bg-bad text-white hover:brightness-110',
    red: 'bg-redA text-white hover:brightness-110',
    blue: 'bg-blueA text-white hover:brightness-110',
    good: 'bg-good text-white hover:brightness-110',
  };
  const s = { sm: 'h-9 px-3 text-sm min-w-9', md: 'h-12 px-4 min-w-12', lg: 'h-14 px-5 text-lg min-w-14' }[size];
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl transition select-none active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none',
        v[variant],
        s,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ className, children, title, actions }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('rounded-2xl border border-line bg-surface p-4', className)}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ children, tone = 'neutral', className, title }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'saxon' | 'red' | 'blue'; className?: string; title?: string }) {
  const t = {
    neutral: 'bg-surface-2 text-muted border-line',
    good: 'bg-good/15 text-good border-good/40',
    warn: 'bg-warn/15 text-warn border-warn/40',
    bad: 'bg-bad/15 text-bad border-bad/40',
    saxon: 'bg-saxon/20 text-saxon border-saxon/50',
    red: 'bg-redA/15 text-redA border-redA/40',
    blue: 'bg-blueA/15 text-blueA border-blueA/40',
  }[tone];
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', t, className)}>
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, n, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; n?: number; className?: string }) {
  return (
    <div className={cx('rounded-xl bg-surface-2 p-3', className)}>
      <div className="text-xs text-muted">{label}</div>
      <div className="tnum text-2xl font-bold leading-tight">{value}</div>
      {(sub || n !== undefined) && (
        <div className="text-xs text-muted">
          {sub}
          {n !== undefined && <span className="ml-1">n={n}</span>}
        </div>
      )}
    </div>
  );
}

export function N({ n }: { n: number }) {
  return <span className="ml-1 text-[10px] text-muted tnum">n={n}</span>;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: ReactNode; className?: string }[];
  onChange: (v: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={cx('inline-flex rounded-xl border border-line bg-surface-2 p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-lg px-3 font-medium transition',
            size === 'sm' ? 'h-8 text-sm' : 'h-10',
            value === o.value ? o.className ?? 'bg-saxon text-saxon-ink' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * On/off switch. The switch is a real <button>, so the surrounding <label> forwards a tap on the text to it
 * (a <span> is not labelable: tapping the text did nothing) and Space / Enter work natively.
 */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('tap flex cursor-pointer items-center gap-3 select-none', disabled && 'opacity-40')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cx('relative h-7 w-12 shrink-0 rounded-full transition', checked ? 'bg-saxon' : 'bg-surface-2 border border-line')}
      >
        <span className={cx('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}

/**
 * Labelled form row. Default renders a `<label>` so tapping the text focuses the input.
 * Use `as="group"` when the child is a set of buttons: a `<label>` forwards any tap on
 * it (text or gaps) to the FIRST button inside, which would silently pick an option.
 */
export function Field({
  label,
  children,
  hint,
  error,
  as = 'label',
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  as?: 'label' | 'group';
}) {
  const id = useId();
  const extra = (
    <>
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-bad">{error}</span>}
    </>
  );
  if (as === 'group') {
    return (
      <div className="block" role="group" aria-labelledby={`${id}-label`}>
        <span id={`${id}-label`} className="mb-1 block text-sm font-medium">
          {label}
        </span>
        {children}
        {extra}
      </div>
    );
  }
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {extra}
    </label>
  );
}

export const inputCls =
  'h-12 w-full rounded-xl border border-line bg-surface-2 px-3 text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-saxon';

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        className={cx('safe-bottom max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="tap rounded-lg text-muted hover:text-fg" onClick={onClose} aria-label="Close">
            <X className="mx-auto" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ title, children, icon }: { title: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line p-8 text-center text-muted">
      {icon}
      <div className="font-medium text-fg">{title}</div>
      {children}
    </div>
  );
}

export function PageTitle({ children, sub, actions }: { children: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{children}</h1>
        {sub && <p className="text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Tiny inline SVG sparkline (cheap enough for every row of a list). */
export function Sparkline({ values, width = 80, height = 24, className }: { values: number[]; width?: number; height?: number; className?: string }) {
  if (values.length < 2) return <span className="text-xs text-muted">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (width - 4) + 2},${height - 2 - ((v - min) / span) * (height - 4)}`).join(' ');
  const last = values[values.length - 1];
  const lastY = height - 2 - ((last - min) / span) * (height - 4);
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={width - 2} cy={lastY} r={2} fill="var(--saxon)" />
    </svg>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-transparent', className)} />;
}

/** Tap feedback (Android vibrates; iOS Safari ignores silently). */
export function haptic(ms = 12) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      const p = JSON.parse(localStorage.getItem('hh:prefs:v1') || '{}');
      if (p.haptics !== false) navigator.vibrate(ms);
    }
  } catch {
    /* ignore */
  }
}

export function pct(x: number | null | undefined, digits = 0) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmt(x: number | null | undefined, digits = 1) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return x.toFixed(digits);
}
