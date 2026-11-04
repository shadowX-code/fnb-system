class FeedxVoiceCapture extends AudioWorkletProcessor {
 constructor() {
  super();
  this.frame = new Int16Array(480);
  this.offset = 0;
 }
 process(inputs) {
  for (const sample of inputs[0]?.[0] || []) {
   this.frame[this.offset++] = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
   if (this.offset === this.frame.length) {
    this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
    this.frame = new Int16Array(480);
    this.offset = 0;
   }
  }
  return true;
 }
}
registerProcessor('feedx-voice-capture', FeedxVoiceCapture);
