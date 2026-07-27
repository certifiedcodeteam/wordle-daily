import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Cloud, ShieldCheck, Swords, Trophy } from "lucide-react";
import { authPresentation, clearAuthIntent } from "@/lib/auth-flow";
import "@/components/auth.css";

const BOARD = [
  { word: "WORLD", states: ["correct", "correct", "present", "absent", "correct"] },
  { word: "PLAYS", states: ["present", "correct", "correct", "present", "absent"] },
  { word: "DAILY", states: ["correct", "present", "correct", "correct", "correct"] },
];

const BENEFITS = [
  { icon: Cloud, title: "Keep every run", text: "Continue your Daily on any device." },
  { icon: Trophy, title: "Build your player", text: "Earn XP, streaks, tokens, and achievements." },
  { icon: Swords, title: "Unlock every arena", text: "Play Endless, Rush, Duels, and League." },
];

export default function AuthLayout({ icon: Icon = null, title, subtitle, footer = null, children, activeView = null, intent = {} }) {
  const presentation = authPresentation(intent);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let saved = {};
    try { saved = JSON.parse(window.localStorage.getItem("wordle-world-preferences") || "{}"); } catch { /* use system theme */ }
    const applyTheme = () => {
      const dark = saved.theme === "dark" || ((!saved.theme || saved.theme === "system") && media.matches);
      document.documentElement.classList.toggle("wordle-dark", dark);
    };
    applyTheme();
    media.addEventListener?.("change", applyTheme);
    return () => media.removeEventListener?.("change", applyTheme);
  }, []);

  return (
    <main className="auth-shell">
      <Link to="/" className="auth-back" aria-label="Back to game" onClick={() => clearAuthIntent()}><ArrowLeft /></Link>

      <section className="auth-stage" aria-label="Wordle World player benefits">
        <Link to="/" className="auth-brand" aria-label="Wordle World home" onClick={() => clearAuthIntent()}>
          <img src="/icons/wordle-world-192.png" alt="" aria-hidden="true" />
          <span>Wordle World</span>
        </Link>

        <div className="auth-stage-copy">
          <span className="auth-stage-kicker"><ShieldCheck /> {presentation.kicker}</span>
          <strong>{presentation.title}</strong>
          <p>{presentation.subtitle}</p>
        </div>

        <div className="auth-board" aria-hidden="true">
          {BOARD.map((row, rowIndex) => row.word.split("").map((letter, tileIndex) => (
            <span
              key={`${row.word}-${letter}-${tileIndex}`}
              className={`auth-tile is-${row.states[tileIndex]}`}
              style={/** @type {import("react").CSSProperties} */ ({ "--auth-tile-delay": `${(rowIndex * 5 + tileIndex) * 45}ms` })}
            >
              {letter}
            </span>
          )))}
        </div>

        <div className="auth-benefits">
          {BENEFITS.map(({ icon: BenefitIcon, title: benefitTitle, text }) => (
            <div key={benefitTitle}>
              <BenefitIcon aria-hidden="true" />
              <span><strong>{benefitTitle}</strong><small>{text}</small></span>
            </div>
          ))}
        </div>
      </section>

      <section className="auth-entry">
        <div className="auth-entry-inner">
          <Link to="/" className="auth-brand auth-brand-mobile" aria-label="Wordle World home" onClick={() => clearAuthIntent()}>
            <img src="/icons/wordle-world-192.png" alt="" aria-hidden="true" />
            <span>Wordle World</span>
          </Link>

          {activeView && (
            <nav className="auth-view-switcher" aria-label="Account access">
              <Link to="/login" aria-current={activeView === "login" ? "page" : undefined}>Log in</Link>
              <Link to="/register" aria-current={activeView === "register" ? "page" : undefined}>Create player</Link>
            </nav>
          )}

          <header className="auth-heading">
            {!activeView && Icon && <span className="auth-heading-icon"><Icon aria-hidden="true" /></span>}
            <span className="auth-mobile-kicker">{presentation.kicker}</span>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </header>

          <div className="auth-form-area">{children}</div>
          {footer && <div className="auth-footer">{footer}</div>}
        </div>
      </section>
    </main>
  );
}
