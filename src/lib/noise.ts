/** Ambient brown noise generated locally with Web Audio — no audio files, no network. */
let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let source: AudioBufferSourceNode | null = null;

export function startNoise(volume: number) {
  if (!ctx) ctx = new AudioContext();
  if (!source) {
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const out = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < out.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      out[i] = last * 3.5;
    }
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    gain = ctx.createGain();
    source.connect(gain).connect(ctx.destination);
    source.start();
  }
  setNoiseVolume(volume);
  void ctx.resume();
}

export function setNoiseVolume(volume: number) {
  if (gain) gain.gain.value = Math.min(1, Math.max(0, volume)) * 0.5;
}

export function stopNoise() {
  source?.stop();
  source?.disconnect();
  source = null;
  gain = null;
}
