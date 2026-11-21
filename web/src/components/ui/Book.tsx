import { IconBook } from "./icons";

export function Cover({ url, size }: { url?: string | null; size?: "sm" }) {
  const className = `cover${size ? ` ${size}` : ""}`;
  if (url) return <img className={className} src={url} alt="" />;
  return (
    <span className={`${className} no-cover`}>
      <IconBook size={size === "sm" ? 14 : 18} />
    </span>
  );
}

export function Byline({ author, year, extra }: { author?: string | null; year?: number | null; extra?: string }) {
  return (
    <div className="author">
      {author || "Unknown author"}
      {year ? ` · ${year}` : ""}
      {extra ? ` · ${extra}` : ""}
    </div>
  );
}
