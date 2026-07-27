import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, Check, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { authPresentation, completeAuthFlow, readAuthIntent } from "@/lib/auth-flow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";

const READY_WORD = "READY";

export default function Register() {
  const navigate = useNavigate();
  const { checkUserAuth, isAuthenticated } = useAuth();
  const [intent] = useState(readAuthIntent);
  const presentation = authPresentation(intent);
  const [stage, setStage] = useState("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [resending, setResending] = useState(false);
  const [playerResult, setPlayerResult] = useState(null);
  const finishing = useRef(false);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await completeAuthFlow(checkUserAuth);
      setPlayerResult(result);
      setStage("ready");
      setLoading(false);
    } catch (nextError) {
      finishing.current = false;
      setError(nextError.message || "Your player was created, but progress could not be restored. Try again.");
      setLoading(false);
    }
  }, [checkUserAuth]);

  useEffect(() => {
    if (isAuthenticated) finish();
  }, [finish, isAuthenticated]);

  useEffect(() => {
    if (stage !== "otp" || resendSeconds <= 0) return undefined;
    const timer = window.setTimeout(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds, stage]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setFieldError("");
    if (password.length < 8 || !/\d/.test(password)) {
      setFieldError("Use at least 8 characters and include a number.");
      return;
    }
    if (password !== confirmPassword) {
      setFieldError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await base44.auth.register({ email, password });
      setOtpCode("");
      setResendSeconds(30);
      setStage("otp");
    } catch (nextError) {
      setError(nextError.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (completedCode = otpCode) => {
    if (loading || completedCode.length < 6) return;
    setError("");
    setLoading(true);
    try {
      const result = await base44.auth.verifyOtp({ email, otpCode: completedCode });
      if (result?.access_token) base44.auth.setToken(result.access_token);
      await finish();
    } catch (nextError) {
      finishing.current = false;
      setError(nextError.message || "That code did not work. Check all six tiles.");
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resending || resendSeconds > 0) return;
    setError("");
    setResending(true);
    try {
      await base44.auth.resendOtp(email);
      setResendSeconds(30);
    } catch (nextError) {
      setError(nextError.message || "Failed to resend code");
    } finally {
      setResending(false);
    }
  };

  const handleGoogle = () => {
    setLoading(true);
    base44.auth.loginWithProvider("google", "/register?complete=1");
  };

  if (stage === "ready") {
    const profile = playerResult?.player?.profile;
    const account = playerResult?.player?.account;
    return (
      <AuthLayout
        activeView="register"
        intent={intent}
        title="Player ready"
        subtitle="Your progress is linked and the next arena is waiting."
      >
        <div className="auth-ready">
          <div className="auth-ready-board" aria-label="Ready">
            {READY_WORD.split("").map((letter, index) => <span key={letter} style={/** @type {import("react").CSSProperties} */ ({ "--ready-index": index })}>{letter}</span>)}
          </div>
          <div className="auth-player-card">
            <span>Player card</span>
            <strong>{profile?.handle || "Word player"}</strong>
            <small>Level {profile?.level || 1} · {account?.current_streak || 0} day streak</small>
          </div>
          <Button className="auth-primary-button" onClick={() => navigate(playerResult?.destination || "/", { replace: true })}>
            {presentation.action}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  if (stage === "otp") {
    return (
      <AuthLayout
        activeView="register"
        intent={intent}
        title="Enter your six tiles"
        subtitle={<>We sent a code to <strong>{email}</strong>.</>}
      >
        {error && <div className="auth-alert" role="alert"><AlertCircle aria-hidden="true" /><span>{error}</span></div>}
        <div className="auth-otp-wrap">
          <InputOTP
            maxLength={6}
            value={otpCode}
            onChange={setOtpCode}
            onComplete={handleVerify}
            autoFocus
            autoComplete="one-time-code"
            aria-label="Six digit verification code"
          >
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((index) => <InputOTPSlot key={index} index={index} />)}
            </InputOTPGroup>
          </InputOTP>
          <Button className="auth-primary-button" onClick={() => handleVerify()} disabled={loading || otpCode.length < 6}>
            {loading ? <><Loader2 className="animate-spin" /> Checking tiles...</> : "Verify player"}
          </Button>
          <div className="auth-otp-actions">
            <button type="button" className="auth-text-button" onClick={handleResend} disabled={resending || resendSeconds > 0}>
              {resending ? "Sending..." : resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
            </button>
            <span>or</span>
            <button type="button" className="auth-text-button" onClick={() => { setStage("form"); setOtpCode(""); setError(""); }}>change email</button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  const hasMinimum = password.length >= 8;
  const hasNumber = /\d/.test(password);

  return (
    <AuthLayout
      activeView="register"
      intent={intent}
      title={presentation.title}
      subtitle="Create your player to save progress and unlock every mode."
      footer={<>Already have a player? <Link to="/login">Log in</Link></>}
    >
      {error && <div className="auth-alert" role="alert"><AlertCircle aria-hidden="true" /><span>{error}</span></div>}

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
            <Input id="email" type="email" autoComplete="email" autoFocus placeholder="player@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </div>
        </div>

        <PasswordField id="password" label="Password" value={password} onChange={setPassword} visible={passwordVisible} onToggle={() => setPasswordVisible((visible) => !visible)} />

        <div className="auth-password-rules" aria-live="polite">
          <span className={hasMinimum ? "is-met" : ""}><Check /> 8 characters</span>
          <span className={hasNumber ? "is-met" : ""}><Check /> Include a number</span>
        </div>

        <PasswordField id="confirm" label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} visible={confirmVisible} onToggle={() => setConfirmVisible((visible) => !visible)} error={fieldError} />

        <Button type="submit" className="auth-primary-button" disabled={loading}>
          {loading ? <><Loader2 className="animate-spin" /> Creating player...</> : "Create player"}
        </Button>
      </form>
    </AuthLayout>
  );
}

function PasswordField({ id, label, value, onChange, visible, onToggle, error = "" }) {
  return (
    <div className="auth-field">
      <Label htmlFor={id}>{label}</Label>
      <div className="auth-input-wrap">
        <Lock aria-hidden="true" />
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          placeholder="8 or more characters"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={Boolean(error)}
          minLength={8}
          required
        />
        <button type="button" className="auth-password-toggle" onClick={onToggle} aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>
          {visible ? <EyeOff /> : <Eye />}
        </button>
      </div>
      {error && <p id={`${id}-error`} className="auth-field-error">{error}</p>}
    </div>
  );
}
