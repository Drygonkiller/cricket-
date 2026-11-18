const MUTE_KEY = "super-over-smash:muted";

export function connectMatchAudio(toggle) {
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "true"; } catch {}
  let audio;
  let audioMaster;
  let audioUnavailable = false;

  function unlockSound() {
    if (muted || audioUnavailable) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) { audioUnavailable = true; return; }
      if (!audio) {
        audio = new Audio();
        audioMaster = audio.createGain();
        audioMaster.connect(audio.destination);
      }
      if (audio.state === "suspended") audio.resume().catch(() => {});
    } catch {
      audioUnavailable = true;
    }
  }

  function tone(frequency, end, duration, volume, type = "sine", delay = 0) {
    const now = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(end, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(gain).connect(audioMaster);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  function playSound(kind) {
    if (muted || !audio || audio.state !== "running") return;
    try {
      if (kind === "click") tone(600, 380, .045, .022);
      if (kind === "bounce") tone(165, 82, .075, .040, "triangle");
      if (kind === "hit") tone(235, 70, .10, .085, "triangle");
      if (kind === "wicket") {
        tone(420, 290, .18, .05, "triangle");
        tone(265, 125, .28, .055, "triangle", .13);
      }
      if (kind === "cheer") {
        const samples = audio.createBuffer(1, Math.floor(audio.sampleRate * .65), audio.sampleRate);
        const data = samples.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / data.length);
        const noise = audio.createBufferSource();
        const filter = audio.createBiquadFilter();
        const gain = audio.createGain();
        noise.buffer = samples;
        filter.type = "bandpass";
        filter.frequency.value = 780;
        gain.gain.value = .13;
        noise.connect(filter).connect(gain).connect(audioMaster);
        noise.start();
      }
    } catch {
      // Audio support must never interrupt a match.
    }
  }

  function updateMute(next) {
    muted = next;
    if (audioMaster) audioMaster.gain.value = muted ? 0 : 1;
    toggle.textContent = muted ? "Sound off" : "Sound on";
    toggle.setAttribute("aria-pressed", String(!muted));
  }

  updateMute(muted);
  toggle.addEventListener("click", () => {
    updateMute(!muted);
    try { localStorage.setItem(MUTE_KEY, JSON.stringify(muted)); } catch {}
    unlockSound();
    playSound("click");
  });
  window.addEventListener("storage", event => {
    if (event.key === MUTE_KEY) updateMute(event.newValue === "true");
  });
  document.addEventListener("pointerdown", unlockSound, true);
  document.addEventListener("keydown", unlockSound, true);
  return playSound;
}
