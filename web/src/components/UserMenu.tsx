import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconLogOut, IconUser } from "./ui/icons";

interface UserMenuProps {
  username: string;
  onAccount: () => void;
  onLogout: () => void;
}

export default function UserMenu({ username, onAccount, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="link user-menu-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Account menu"
      >
        <span className="user-menu-name">{username}</span>
        <IconChevronDown size={14} className={`user-menu-chevron${open ? " open" : ""}`} />
      </button>
      {open && (
        <div className="user-menu-card" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAccount();
            }}
          >
            <IconUser />
            My Account
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <IconLogOut />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
