import { useState } from "react";
import { ArrowLeft, CheckCircle2, Database, LoaderCircle, ShieldAlert, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { worldApi } from "@/api/worldClient";
import { useAuth } from "@/lib/AuthContext";
import "./admin.css";

const ADMIN_EMAIL = "wing@certifiedcode.us";

export default function Admin() {
  const { user, isAuthenticated, navigateToLogin } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const isAdmin = user?.email?.trim().toLowerCase() === ADMIN_EMAIL;

  const resetDemo = async () => {
    setStatus("working");
    setError("");
    try {
      const nextResult = await worldApi.resetDemo();
      setResult(nextResult);
      setStatus("complete");
    } catch (nextError) {
      setError(nextError.message || "The demo reset failed.");
      setStatus("idle");
    }
  };

  if (!isAuthenticated) {
    return (
      <main className="admin-shell admin-gate">
        <ShieldAlert aria-hidden="true" />
        <h1>Sign in required</h1>
        <p>This page is restricted to the application owner.</p>
        <button type="button" onClick={navigateToLogin}>Sign in</button>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="admin-shell admin-gate">
        <span className="admin-code">404</span>
        <h1>Page not found</h1>
        <Link to="/play/daily">Return to Wordle World</Link>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <Link to="/play/daily" className="admin-back" aria-label="Back to game" title="Back to game"><ArrowLeft /></Link>
        <div className="admin-brand"><span aria-hidden="true" /><strong>Wordle World</strong><small>Admin</small></div>
      </header>

      <section className="admin-workspace">
        <div className="admin-heading">
          <span><Database /> Data controls</span>
          <h1>Demo environment</h1>
          <p>Reset gameplay and progression data, then load a complete demo state for the current owner account.</p>
        </div>

        <div className="admin-control-row">
          <div>
            <strong>Clear data and seed demo</strong>
            <p>Authentication users stay intact. All game records are replaced with demo progression, inventory, quests, and league standings.</p>
          </div>
          <button type="button" className="admin-danger-button" onClick={() => setConfirmOpen(true)} disabled={status === "working"}>
            {status === "working" ? <LoaderCircle className="admin-spinner" /> : <Trash2 />}
            {status === "working" ? "Resetting..." : "Clear & seed demo"}
          </button>
        </div>

        {status === "complete" && result && (
          <div className="admin-result" role="status">
            <CheckCircle2 />
            <div><strong>Demo data is ready</strong><span>{result.seededRecords} records seeded for {result.ownerEmail}.</span></div>
          </div>
        )}
        {error && <div className="admin-error" role="alert">{error}</div>}
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => status !== "working" && setConfirmOpen(open)}>
        <AlertDialogContent className="admin-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Replace all application data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently clears gameplay and progression records for every player, then seeds a new demo dataset. Authentication accounts are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={status === "working"}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="admin-confirm-action" disabled={status === "working"} onClick={resetDemo}>
              Clear & seed demo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
