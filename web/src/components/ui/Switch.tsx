interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  title?: string;
  label?: string;
}

export function Switch({ checked, onChange, title, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ?? title}
      className={`switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
      title={title}
    >
      <span className="knob" />
    </button>
  );
}
