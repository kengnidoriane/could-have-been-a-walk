// Recording a voice memo and turning it into what the local model can hear: 16 kHz mono WAV,
// cut into pieces of at most 30 s. Everything happens in this browser tab.

const RATE = 16_000;

export function startRecording(stream: MediaStream): {
  stop: () => Promise<Blob>;
} {
  const recorder = new MediaRecorder(stream);
  const parts: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) parts.push(e.data);
  };
  recorder.start(1000);
  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(parts, { type: recorder.mimeType }));
        };
        recorder.stop();
      }),
  };
}

function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Decode, downmix to mono, resample to 16 kHz, cut into ≤ 30 s WAV pieces (base64). */
export async function toWavChunks(recording: Blob, chunkSeconds = 30): Promise<string[]> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await recording.arrayBuffer());
  void ctx.close();
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * RATE), RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const samples = (await offline.startRendering()).getChannelData(0);
  const per = chunkSeconds * RATE;
  const chunks: string[] = [];
  for (let i = 0; i < samples.length; i += per) {
    chunks.push(toBase64(encodeWav(samples.subarray(i, i + per), RATE)));
  }
  return chunks;
}
