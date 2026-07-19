// Real audio-signal waveform via the Web Audio API's AnalyserNode.
//
// IMPORTANT — why we tap with captureStream(), NOT createMediaElementSource():
// createMediaElementSource() REPLACES the <audio> element's own output with the
// Web Audio graph. When the audio is cross-origin without CORS headers (which is
// the case for almost all pasted third-party links), Chrome taints it and the
// AnalyserNode outputs ZEROES — and that zeroing can silence the actual speakers
// too ("nothing plays, but the UI shows playing"). That is a known, nasty trap.
//
// captureStream() instead gives a read-only tap: the element keeps playing
// through its own output (always audible), and we connect the tapped stream to
// the analyser ONLY (never to ctx.destination), so it never affects playback.
// CORS-tainted sources simply read as silence, and we fall back to decorative
// bars — without ever breaking sound.
//
// The analyser writes bar heights directly to the DOM in a requestAnimationFrame
// loop, decoupled from render()'s full innerHTML rebuilds.
import { store, audio } from './store.js';

let ctx = null;
let analyser = null;
let streamSource = null;
let dataArray = null;
let rafId = null;
let realSignalSeen = false; // becomes true once we read any non-zero sample

export function isWaveformActive() {
  return realSignalSeen;
}

// Build (once) a read-only analyser tap over the element via captureStream().
// The AudioContext is created + resumed from a user gesture elsewhere; here we
// just connect sourceStream -> analyser (NO destination, so playback is untouched).
export function initWaveformGraph() {
  if (ctx) return true;
  try {
    if (typeof audio.captureStream !== 'function') return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const stream = audio.captureStream();
    streamSource = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 128; // -> 64 frequency bins, close to the 40 rendered bars
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    streamSource.connect(analyser); // analyser is a sink; nothing connects to destination
    return true;
  } catch (e) {
    console.warn('Waveform analyser unavailable', e && e.message);
    ctx = null; analyser = null; streamSource = null;
    return false;
  }
}

// Called when playback begins. Starts the analyser RAF loop if a graph exists.
export function startWaveform() {
  if (!analyser) return;
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (rafId == null) loop();
}

export function stopWaveform() {
  if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
}

function loop() {
  rafId = requestAnimationFrame(loop);
  if (!analyser || !dataArray) return;
  analyser.getByteFrequencyData(dataArray);

  const bars = document.querySelectorAll('.cn-waveform .cn-bar');
  if (bars.length === 0) return;

  let anySignal = false;
  const bins = dataArray.length;
  for (let i = 0; i < bars.length; i++) {
    const v = dataArray[Math.floor((i / bars.length) * bins)] || 0;
    if (v > 0) anySignal = true;
    const h = 6 + (v / 255) * 94; // 6%..100%
    bars[i].style.height = h.toFixed(1) + '%';
  }

  // First time we see real audio data (CORS-permissive source), mark the real
  // waveform active so render() stops drawing decorative bars.
  if (anySignal && !realSignalSeen) {
    realSignalSeen = true;
    document.querySelector('.cn-waveform')?.classList.add('cn-waveform-live');
  }
}
