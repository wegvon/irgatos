// Irgatos Live voice: hands microphone frames from the audio thread to the
// page in batches, which resamples them to 16 kHz PCM for Gemini Live.
const BATCH = 2048;

class IrgatLiveCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BATCH);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let offset = 0;
    while (offset < channel.length) {
      const take = Math.min(BATCH - this.filled, channel.length - offset);
      this.buffer.set(channel.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === BATCH) {
        this.port.postMessage(this.buffer);
        this.buffer = new Float32Array(BATCH);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("irgat-live-capture", IrgatLiveCapture);
