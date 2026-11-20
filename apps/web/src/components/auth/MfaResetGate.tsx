"use client";

/**
 * Mandatory authenticator enrollment after a privileged factor reset
 * (T6.09, AC-F02-4, D-70).
 *
 * The API reports `mfaResetRequired` on GET /auth/session and refuses every
 * other route with `403 MFA_RESET_REQUIRED`. This gate reuses the authenticator
 * dialog in its mandatory form: the dialog enrolls one TOTP factor at once and
 * verifies the code. The gate then reads the session again, and the cleared
 * flag closes the gate. Sign out stays available.
 */

import { MfaSettingsDialog } from "@/components/MfaSettingsDialog";
import { useRole } from "@/context/RoleContext";

export function MfaResetGate() {
  const { mfaResetRequired, refreshSession, endSession } = useRole();

  if (!mfaResetRequired) return null;

  return (
    <MfaSettingsDialog
      mandatory
      onClose={() => {
        void endSession().then(() => window.location.replace("/"));
      }}
      onVerified={refreshSession}
    />
  );
}
