"use client";

import { useEffect, useState, type FormEvent } from "react";
import { UserRound, X } from "lucide-react";
import { useRole } from "@/context/RoleContext";
import { updateAvatarUrl } from "@/lib/auth/session";

interface ProfileSettingsDialogProps {
  onClose: () => void;
}

/**
 * User-owned profile photo control. The URL is stored in Supabase user
 * metadata as `avatar_url`; the API reads it for GET /auth/session. The
 * identity context is updated immediately so the header photo changes
 * without a reload.
 */
export function ProfileSettingsDialog({ onClose }: ProfileSettingsDialogProps) {
  const { identity, setIdentity } = useRole();
  const [avatarUrl, setAvatarUrl] = useState(identity?.avatarUrl ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const saved = await updateAvatarUrl(avatarUrl);
      setIdentity({
        displayName: identity?.displayName ?? null,
        email: identity?.email ?? null,
        avatarUrl: saved,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Your profile photo could not be saved. Try again.",
      );
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-settings-title"
        data-testid="profile-settings"
        className="glass-panel rounded-3xl max-w-md w-full p-6 space-y-5 border border-[var(--card-border)] relative shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-custom hover:text-heading transition-colors"
          aria-label="Close profile settings"
          data-testid="profile-close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-start gap-3 pr-8">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center shrink-0">
            <UserRound className="w-5 h-5 text-cyan-300" />
          </div>
          <div className="space-y-1">
            <h2
              id="profile-settings-title"
              className="font-display text-xl font-bold text-heading"
            >
              Profile settings
            </h2>
            <p className="text-xs text-muted-custom">
              Set the photo shown beside your name.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 font-mono text-xs"
          data-testid="profile-form"
        >
          <div>
            <label
              htmlFor="profile-avatar-url"
              className="block text-muted-custom mb-1"
            >
              Avatar URL
            </label>
            <input
              id="profile-avatar-url"
              type="url"
              inputMode="url"
              maxLength={2048}
              autoFocus
              value={avatarUrl}
              onChange={(event) => setAvatarUrl(event.target.value)}
              placeholder="https://example.com/photo.jpg"
              className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3 text-heading focus:outline-none focus:border-brand-cyan"
              data-testid="profile-avatar-url"
            />
            <p className="mt-2 text-[11px] text-muted-custom">
              Use an HTTPS image URL. Leave it empty to remove your photo.
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="text-red-400 font-bold text-xs"
              data-testid="profile-error"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl glass-panel text-xs font-bold text-muted-custom hover:text-heading transition-colors"
              data-testid="profile-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan text-white font-bold text-xs shadow-lg hover:opacity-90 transition-opacity disabled:opacity-60"
              data-testid="profile-save"
            >
              {saving ? "Saving..." : "Save photo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
