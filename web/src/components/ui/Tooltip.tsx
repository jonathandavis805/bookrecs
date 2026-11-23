import { type ReactNode, useEffect, useRef, useState } from "react";

const DELAY = 300;
const STAYS_WARM = 300;

// When any tooltip last closed. Moving straight on to the next shows it at once, unanimated.
let closedAt = 0;

// `held` keeps it open for a touch.
export function Tooltip({ label, held = false, children }: { label?: string; held?: boolean; children: ReactNode }) {
  const [shown, setShown] = useState<"delayed" | "instant" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!label) return children;

  function open() {
    clearTimeout(timer.current);
    if (Date.now() - closedAt < STAYS_WARM) setShown("instant");
    else timer.current = setTimeout(() => setShown("delayed"), DELAY);
  }

  function close() {
    clearTimeout(timer.current);
    if (shown) closedAt = Date.now();
    setShown(null);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: disabled buttons don't reliably report hover, so a wrapper listens
    <span
      className="tooltip-anchor"
      onPointerEnter={(e) => e.pointerType === "mouse" && open()}
      onPointerLeave={close}
      onPointerDown={close}
      onFocus={(e) => e.target.matches(":focus-visible") && open()}
      onBlur={close}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      {children}
      {(shown || held) && (
        <span className={`tooltip${!held && shown === "delayed" ? " animated" : ""}`} role="tooltip">
          {label}
        </span>
      )}
    </span>
  );
}
