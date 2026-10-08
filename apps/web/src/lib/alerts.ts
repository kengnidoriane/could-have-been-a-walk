// Getting attention outdoors: vibration where the browser allows it (Android Chrome), a sound
// everywhere (iOS has no Vibration API), and a full-screen colour change in the UI.

let audio: AudioContext | null = null;

/** Must run inside a tap: browsers only allow sound after a user gesture. */
export function unlockAudio() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    audio = null;
  }
}

function beep(at: number, frequency: number, durationS: number) {
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + durationS);
  osc.connect(gain).connect(audio.destination);
  osc.start(at);
  osc.stop(at + durationS + 0.05);
}

export function alertTurnBack() {
  navigator.vibrate?.([500, 200, 500, 200, 900]);
  if (audio) {
    const t = audio.currentTime + 0.05;
    [0, 0.3, 0.6].forEach((offset) => beep(t + offset, 880, 0.2));
  }
}

export function alertGentle() {
  navigator.vibrate?.(80);
  if (audio) beep(audio.currentTime + 0.05, 660, 0.15);
}

/** Keep the screen on during the walk, and again after the tab comes back to the front. */
export function keepScreenOn(): () => void {
  let sentinel: WakeLockSentinel | null = null;
  let released = false;
  const request = () => {
    if (released || document.visibilityState !== 'visible') return;
    navigator.wakeLock
      ?.request('screen')
      .then((s) => {
        sentinel = s;
      })
      .catch(() => undefined);
  };
  request();
  document.addEventListener('visibilitychange', request);
  return () => {
    released = true;
    document.removeEventListener('visibilitychange', request);
    void sentinel?.release().catch(() => undefined);
  };
}
