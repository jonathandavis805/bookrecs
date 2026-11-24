export function Tabs<T extends string>({
  tabs,
  selected,
  onSelect,
}: {
  tabs: { id: T; label: string; count?: number }[];
  selected: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={t.id === selected ? "active" : ""}
          aria-pressed={t.id === selected}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
