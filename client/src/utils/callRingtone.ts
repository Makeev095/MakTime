/** Looping ringtone / ringback using Web Audio (no asset files). */

type Tone = { freq: number; start: number; dur: number };

let sharedCtx: AudioContext | null = null;
let stopCurrent: (() => void) | null = null;

function getCtx(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContext();
  }
  return sharedCtx;
}

function playPattern(pattern: Tone[], loopGapSec: number): () => void {
  stopCurrent?.();
  const ctx = getCtx();
  void ctx.resume().catch(() => {});

  let cancelled = false;
  let timer: number | undefined;
  const nodes: Array<OscillatorNode | GainNode> = [];

  const playOnce = () => {
    if (cancelled) return;
    const t0 = ctx.currentTime + 0.02;
    for (const tone of pattern) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = tone.freq;
      const start = t0 + tone.start;
      const end = start + tone.dur;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.01);
      nodes.push(osc, gain);
    }
    const cycle = pattern.reduce((m, t) => Math.max(m, t.start + t.dur), 0) + loopGapSec;
    timer = window.setTimeout(playOnce, cycle * 1000);
  };

  playOnce();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    nodes.forEach((n) => {
      try {
        if ('stop' in n) (n as OscillatorNode).stop();
      } catch { /* already stopped */ }
      try { n.disconnect(); } catch { /* ignore */ }
    });
  };
}

/** Incoming call ringtone (phone-like two-tone loop). */
export function startIncomingRingtone(): () => void {
  const pattern: Tone[] = [
    { freq: 880, start: 0, dur: 0.22 },
    { freq: 988, start: 0.24, dur: 0.22 },
    { freq: 880, start: 0.48, dur: 0.22 },
    { freq: 988, start: 0.72, dur: 0.22 },
  ];
  stopCurrent = playPattern(pattern, 1.1);
  return () => {
    stopCurrent?.();
    stopCurrent = null;
  };
}

/** Outgoing ringback while waiting for answer. */
export function startOutgoingRingback(): () => void {
  const pattern: Tone[] = [
    { freq: 425, start: 0, dur: 0.9 },
    { freq: 425, start: 1.0, dur: 0.9 },
  ];
  stopCurrent = playPattern(pattern, 1.6);
  return () => {
    stopCurrent?.();
    stopCurrent = null;
  };
}

export function stopCallRingtone() {
  stopCurrent?.();
  stopCurrent = null;
}
