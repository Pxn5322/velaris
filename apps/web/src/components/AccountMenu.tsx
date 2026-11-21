"use client";

import { useEffect, useRef } from "react";
import { Camera, KeyRound, Pencil } from "lucide-react";

export type ProfileSection = "photo" | "name" | "mfa";

interface AccountMenuProps {
  open: boolean;
  onClose: () => void;
  onSelect: (section: ProfileSection) => void;
  variant: "desktop" | "drawer";
}

/**
 * Account actions opened by clicking the identity block. The menu keeps the
 * header free of extra icon buttons and offers the editable profile fields
 * and authenticator settings. Sign out stays a separate control in the drawer.
 */
export function AccountMenu({
  open,
  onClose,
  onSelect,
  variant,
}: AccountMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  const itemClass =
    "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-mono font-bold text-heading hover:bg-[var(--pill-bg)] transition-colors";

  return (
    <div
      ref={ref}
      role="menu"
      data-testid={`account-menu-${variant}`}
      className={
        variant === "desktop"
          ? "absolute right-0 top-full z-[70] mt-2 w-48 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-1.5 shadow-2xl"
          : "mt-2 w-full rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-1.5"
      }
    >
      <button
        type="button"
        role="menuitem"
        data-testid={`account-menu-photo-${variant}`}
        className={itemClass}
        onClick={() => onSelect("photo")}
      >
        <Camera className="h-3.5 w-3.5 text-cyan-300" />
        Change photo
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid={`account-menu-name-${variant}`}
        className={itemClass}
        onClick={() => onSelect("name")}
      >
        <Pencil className="h-3.5 w-3.5 text-cyan-300" />
        Edit name
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid={`account-menu-mfa-${variant}`}
        className={itemClass}
        onClick={() => onSelect("mfa")}
      >
        <KeyRound className="h-3.5 w-3.5 text-cyan-300" />
        Authenticators
      </button>
    </div>
  );
}
