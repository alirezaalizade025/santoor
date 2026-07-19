// Real audio-signal waveform via the Web Audio API's AnalyserNode.
//
// Two hard constraints shape this module:
//   1. AudioContext can only start after a user gesture (autoplay policy), and
//      — critically — once a <audio> element is fed through an AudioContext
//      graph, the element's own output is REPLACED by that graph. If the
//      context is left suspended, audio enters the graph and never reaches the
//      speakers (UI shows "playing" but you hear nothing). So we MUST build and
//      resume() the graph from inside a genuine user gesture (see player.js
//      unlockAudioOnGesture), never from a programmatic play() callback.
//   2. Cross-origin audio WITHOUT permissive CORS headers "taints" the media
//      element: the AnalyserNode then reads all-zero samples (silence). Most
//      pasted links fall in this bucket, so we detect an all-silent signal and
//      fall back to the decorative bars in render.js — the visualizer is a
//      progressive enhancement, never a requirement.
//
// The analyser writes bar heights directly to the DOM in a requestAnimationFrame
// loop, decoupled from render()'s full innerHTML rebuilds (which fire on every
// timeupdate and would otherwise reset any animation).
import { store, audio } from './store.js';

let ctx = null;
let analyser = null;
let sourceNode = null;
let dataArray = null;
let rafId = null;
let realSignalSeen = false; // becomes true once we read any non-zero sample

export function isWaveformActive() {
  return realSignalSeen;
}

// Build the analyser graph AND resume the AudioContext. This must be called
// from a real user gesture so the context starts in the "running" state and
// audio actually reaches ctx.destination. Guarded so the MediaElementSource is
// created at most once per element (re-creating throws).
export function initWaveformGraph() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return true; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  try {
    ctx = new AC();
    sourceNode = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 128; // -> 64 frequency bins, close to the 40 rendered bars
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    // Route element output through the analyser to the speakers. The context
    // being running (resumed in a gesture) is what keeps sound audible.
    sourceNode.connect(analyser);
    analyser.connect(ctx.destination);
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  } catch (e) {
    // createMediaElementSource can throw if already created or blocked; give up
    // gracefully and let render.js keep the decorative bars.
    console.warn('Waveform analyser unavailable', e && e.message);
    ctx = null; sourceNode = null; analyser = null;
    return false;
  }
}

// Called when playback begins. Starts the analyser RAF loop (graph is assumed
// already built + resumed from a user gesture; if not, there's nothing to draw
// yet and the decorative bars remain).
export function startWaveform() {
  if (!analyser) return;
  if (rafId == null) loop();
}

export function stopWaveform() {
  if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
}

function loop() {
  rafId = requestAnimationFrame(loop);
  if (!analyser) return;
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

  // First time we see real audio data, flip the flag and let render() know it can
  // stop drawing the fake sine-wave bars (real heights now come from here).
  if (anySignal && !realSignalSeen) {
    realSignalSeen = true;
    document.querySelector('.cn-waveform')?.classList.add('cn-waveform-live');
  }
}
