import { useCallback, useEffect, useState } from "react";
import { setMusicEnabled, setSoundEnabled, unlockAudio } from "@/lib/wordle/audio";

const STORAGE_KEY = "wordle-world-preferences";
const DEFAULTS = { soundEnabled: true, hapticsEnabled: true, theme: "system" };

function loadPreferences() {
  try {
    return { ...DEFAULTS, ...JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function useGamePreferences() {
  const [preferences, setPreferences] = useState(loadPreferences);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    setSoundEnabled(preferences.soundEnabled);
    setMusicEnabled(false);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark = preferences.theme === "dark" || (preferences.theme === "system" && media.matches);
      document.documentElement.classList.toggle("wordle-dark", dark);
    };
    applyTheme();
    media.addEventListener?.("change", applyTheme);
    return () => media.removeEventListener?.("change", applyTheme);
  }, [preferences]);

  const updatePreference = useCallback((name, value) => {
    setPreferences((current) => ({ ...current, [name]: value }));
  }, []);

  const haptic = useCallback((pattern) => {
    if (preferences.hapticsEnabled && navigator.vibrate) navigator.vibrate(pattern);
  }, [preferences.hapticsEnabled]);

  return { preferences, updatePreference, haptic, unlockAudio };
}
