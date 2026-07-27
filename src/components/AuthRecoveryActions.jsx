import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AuthRecoveryActions({ onRetry, busy = false }) {
  return (
    <div className="auth-recovery-actions">
      <Button type="button" variant="outline" onClick={onRetry} disabled={busy}>
        <RefreshCw aria-hidden="true" /> Retry setup
      </Button>
      <Link to="/play/daily">Return to Daily</Link>
    </div>
  );
}

