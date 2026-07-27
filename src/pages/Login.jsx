import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { authPresentation, completeAuthFlow, readAuthIntent } from "@/lib/auth-flow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
import AuthRecoveryActions from "@/components/AuthRecoveryActions";

export default function Login() {
  const navigate = useNavigate();
  const { checkUserAuth, isAuthenticated } = useAuth();
  const [intent] = useState(readAuthIntent);
  const presentation = authPresentation(intent);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const finishing = useRef(false);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await completeAuthFlow(checkUserAuth);
      navigate(result.destination, { replace: true });
    } catch (nextError) {
      finishing.current = false;
      setError(nextError.message || "Signed in, but your player data could not be restored. Try again.");
      setLoading(false);
    }
  }, [checkUserAuth, navigate]);

  useEffect(() => {
    if (isAuthenticated) finish();
  }, [finish, isAuthenticated]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await base44.auth.loginViaEmailPassword(email, password);
      await finish();
    } catch (nextError) {
      finishing.current = false;
      setError(nextError.message || "Invalid email or password");
      setLoading(false);
    }
  };

  const handleGoogle = () => {
    setLoading(true);
    base44.auth.loginWithProvider("google", "/login?complete=1");
  };

  return (
    <AuthLayout
      activeView="login"
      intent={intent}
      title={presentation.title}
      subtitle={presentation.subtitle}
      footer={<>New to Wordle World? <Link to="/register">Create your player</Link></>}
    >
      {error && <div className="auth-alert" role="alert"><AlertCircle aria-hidden="true" /><span>{error}</span></div>}
      {error && isAuthenticated && <AuthRecoveryActions onRetry={finish} busy={loading} />}

      <Button type="button" variant="outline" className="auth-google-button" onClick={handleGoogle} disabled={loading}>
        <GoogleIcon className="w-5 h-5" />
        Continue with Google
      </Button>

      <div className="auth-divider">or use email</div>

      <form onSubmit={handleSubmit} className="auth-form">
        <div className="auth-field">
          <Label htmlFor="email">Email</Label>
          <div className="auth-input-wrap">
            <Mail aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="player@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
        </div>

        <div className="auth-field">
          <div className="auth-label-row">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="auth-field-link">Forgot password?</Link>
          </div>
          <div className="auth-input-wrap">
            <Lock aria-hidden="true" />
            <Input
              id="password"
              type={passwordVisible ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setPasswordVisible((visible) => !visible)}
              aria-label={passwordVisible ? "Hide password" : "Show password"}
            >
              {passwordVisible ? <EyeOff /> : <Eye />}
            </button>
          </div>
        </div>

        <Button type="submit" className="auth-primary-button" disabled={loading}>
          {loading ? <><Loader2 className="animate-spin" /> Restoring player...</> : presentation.action}
        </Button>
      </form>
    </AuthLayout>
  );
}
