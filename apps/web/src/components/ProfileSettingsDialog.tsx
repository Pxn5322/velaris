"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Camera, Pencil, UserRound, X } from "lucide-react";
import { useRole } from "@/context/RoleContext";
import { updateProfile } from "@/lib/auth/session";
import { fileToAvatarDataUrl } from "@/lib/profile/image";
import type { ProfileSection } from "@/components/AccountMenu";

interface ProfileSettingsDialogProps {
  section: ProfileSection;
  onClose: () => void;
}

/**
 * Self-service profile editor opened from the identity menu. The photo mode
 * accepts a local image file, not a remote URL; the name mode edits the
 * database display name. Both calls are scoped to the verified session user
 * by PATCH /auth/profile.
 */
export function ProfileSettingsDialog({
  section,
  onClose,
}: ProfileSettingsDialogProps) {
  const { identity, setIdentity } = useRole();
  const [name, setName] = useState(identity?.displayName ?? "");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(
    identity?.avatarUrl ?? null,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const applySaved = (saved: {
    displayName: string;
    avatarUrl: string | null;
  }) => {
    setIdentity({
      displayName: saved.displayName,
      email: identity?.email ?? null,
      avatarUrl: saved.avatarUrl,
    });
    onClose();
  };

  const saveName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      applySaved(await updateProfile({ displayName: name }));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your name could not be saved. Try again.",
      );
      setSaving(false);
    }
  };

  const choosePhoto = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setPreparing(true);
    try {
      setAvatarDataUrl(await fileToAvatarDataUrl(file));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The image could not be prepared.",
      );
    } finally {
      setPreparing(false);
    }
  };

  const savePhoto = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!avatarDataUrl) {
      setError("Choose an image first.");
      return;
    }
    setSaving(true);
    try {
      applySaved(await updateProfile({ avatarDataUrl }));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your photo could not be saved. Try again.",
      );
      setSaving(false);
    }
  };

  const removePhoto = async () => {
    setError("");
    setSaving(true);
    try {
      applySaved(await updateProfile({ avatarDataUrl: null }));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your photo could not be removed. Try again.",
      );
      setSaving(false);
    }
  };

  const isPhoto = section === "photo";
  const Icon = isPhoto ? Camera : Pencil;

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
        data-section={section}
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
            <Icon className="w-5 h-5 text-cyan-300" />
          </div>
          <div className="space-y-1">
            <h2
              id="profile-settings-title"
              className="font-display text-xl font-bold text-heading"
            >
              {isPhoto ? "Change profile photo" : "Edit display name"}
            </h2>
            <p className="text-xs text-muted-custom">
              {isPhoto
                ? "Upload a local image. It is resized before saving."
                : "This name appears in the navigation for your account."}
            </p>
          </div>
        </div>

        {isPhoto ? (
          <form
            onSubmit={savePhoto}
            className="space-y-4 font-mono text-xs"
            data-testid="profile-form"
          >
            <div className="flex items-center gap-4">
              <div
                className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--pill-bg)]"
                data-testid="profile-avatar-preview"
              >
                {avatarDataUrl ? (
                  // A local data URL never leaves the API boundary.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarDataUrl}
                    alt="Current profile photo preview"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <UserRound className="h-8 w-8 text-muted-custom" />
                )}
              </div>
              <label
                htmlFor="profile-avatar-file"
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-blue-500/40 bg-blue-600/10 px-4 py-2 font-bold text-heading hover:bg-blue-600/20"
              >
                <Camera className="h-4 w-4 text-cyan-300" />
                {preparing ? "Preparing…" : "Choose image"}
              </label>
              <input
                id="profile-avatar-file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                data-testid="profile-avatar-file"
                onChange={(event) => void choosePhoto(event.target.files?.[0])}
              />
            </div>
            <p className="text-[11px] text-muted-custom">
              PNG, JPEG or WebP. The image is cropped to a square and resized to
              256 px.
            </p>

            {error && (
              <p
                role="alert"
                className="text-red-400 font-bold text-xs"
                data-testid="profile-error"
              >
                {error}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              {identity?.avatarUrl && (
                <button
                  type="button"
                  onClick={() => void removePhoto()}
                  disabled={saving}
                  className="mr-auto px-3 py-2 rounded-xl text-xs font-bold text-rose-400 hover:text-rose-300 disabled:opacity-60"
                  data-testid="profile-remove-photo"
                >
                  Remove photo
                </button>
              )}
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
                disabled={saving || preparing || !avatarDataUrl}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan text-white font-bold text-xs shadow-lg hover:opacity-90 transition-opacity disabled:opacity-60"
                data-testid="profile-save"
              >
                {saving ? "Saving…" : "Save photo"}
              </button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={saveName}
            className="space-y-4 font-mono text-xs"
            data-testid="profile-form"
          >
            <div>
              <label
                htmlFor="profile-display-name"
                className="block text-muted-custom mb-1"
              >
                Display name
              </label>
              <input
                id="profile-display-name"
                type="text"
                required
                minLength={2}
                maxLength={80}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3 text-heading focus:outline-none focus:border-brand-cyan"
                data-testid="profile-display-name"
              />
              <p className="mt-2 text-[11px] text-muted-custom">
                Use 2–80 characters.
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
                disabled={saving || name.trim().length < 2}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan text-white font-bold text-xs shadow-lg hover:opacity-90 transition-opacity disabled:opacity-60"
                data-testid="profile-save"
              >
                {saving ? "Saving…" : "Save name"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
