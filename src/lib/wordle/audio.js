// Lightweight Web Audio engine: synthesized sound effects + generative background music.
let ctx = null;
let sfxOn = true;
let musicOn = false;
let musicGain = null;
let musicTimer = null;
let musicStep = 0;

function getContext() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone({ freq, freqEnd, duration = 0.12, type = "sine", gain = 0.08, delay = 0 }) {
  const audio = getContext();
  if (!audio) return;
  const start = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, start + duration);
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

export function setSoundEnabled(enabled) {
  sfxOn = enabled;
}

export function setMusicEnabled(enabled) {
  musicOn = enabled;
  if (enabled) startMusic();
  else stopMusic();
}

export function unlockAudio() {
  if (!sfxOn && !musicOn) return;
  getContext();
  if (musicOn && !musicTimer) startMusic();
}

export function playKey() {
  if (sfxOn) tone({ freq: 620, freqEnd: 520, duration: 0.06, type: "triangle", gain: 0.05 });
}

export function playInvalid() {
  if (!sfxOn) return;
  tone({ freq: 190, duration: 0.11, type: "square", gain: 0.05 });
  tone({ freq: 160, duration: 0.13, type: "square", gain: 0.05, delay: 0.12 });
}

export function playReveal() {
  if (!sfxOn) return;
  for (let i = 0; i < 5; i += 1) {
    tone({ freq: 420 + i * 60, duration: 0.07, type: "triangle", gain: 0.045, delay: i * 0.28 });
  }
}

export function playWin() {
  if (!sfxOn) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
    tone({ freq, duration: 0.22, type: "triangle", gain: 0.09, delay: index * 0.13 });
  });
}

export function playLose() {
  if (!sfxOn) return;
  [392, 329.63, 261.63].forEach((freq, index) => {
    tone({ freq, duration: 0.3, type: "sine", gain: 0.08, delay: index * 0.22 });
  });
}

const MUSIC_NOTES = [261.63, 329.63, 392, 440, 392, 329.63, 293.66, 329.63];

function playMusicNote() {
  const audio = getContext();
  if (!audio || !musicOn) return;
  const start = audio.currentTime;
  const freq = MUSIC_NOTES[musicStep % MUSIC_NOTES.length];
  musicStep += 1;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(0.022, start + 0.4);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + 1.9);
  osc.connect(amp).connect(musicGain || audio.destination);
  osc.start(start);
  osc.stop(start + 2);
}

export function startMusic() {
  const audio = getContext();
  if (!audio || musicTimer) return;
  if (!musicGain) {
    musicGain = audio.createGain();
    musicGain.gain.value = 1;
    musicGain.connect(audio.destination);
  }
  playMusicNote();
  musicTimer = window.setInterval(playMusicNote, 2000);
}

export function stopMusic() {
  if (musicTimer) {
    window.clearInterval(musicTimer);
    musicTimer = null;
  }
}