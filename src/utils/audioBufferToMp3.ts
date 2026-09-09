/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
const lamejs = require('lamejs');

export async function audioBufferToMp3(buffer: AudioBuffer, onProgress?: (p: number) => void): Promise<Blob> {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const kbps = 128; // standard quality

  (globalThis as any).MPEGMode = require("lamejs/src/js/MPEGMode.js");
  (globalThis as any).Lame = require("lamejs/src/js/Lame.js");
  (globalThis as any).BitStream = require("lamejs/src/js/BitStream.js");

  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
  const mp3Data: BlobPart[] = [];

  const left = buffer.getChannelData(0);
  const right = channels > 1 ? buffer.getChannelData(1) : left;

  const sampleBlockSize = 1152; 
  
  const leftChunk = new Int16Array(sampleBlockSize);
  const rightChunk = new Int16Array(sampleBlockSize);

  let chunksProcessed = 0;

  for (let i = 0; i < left.length; i += sampleBlockSize) {
    const chunkLength = Math.min(sampleBlockSize, left.length - i);
    
    for (let j = 0; j < chunkLength; j++) {
      let l = left[i + j] * 32767.5;
      let r = right[i + j] * 32767.5;
      l = Math.max(-32768, Math.min(32767, l));
      r = Math.max(-32768, Math.min(32767, r));
      leftChunk[j] = l;
      rightChunk[j] = r;
    }

    let mp3buf;
    if (channels === 2) {
      mp3buf = mp3encoder.encodeBuffer(leftChunk.subarray(0, chunkLength), rightChunk.subarray(0, chunkLength));
    } else {
      mp3buf = mp3encoder.encodeBuffer(leftChunk.subarray(0, chunkLength));
    }
    
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }

    chunksProcessed++;
    if (chunksProcessed % 100 === 0) {
      if (onProgress) onProgress(i / left.length);
      // Yield to main thread to prevent UI freeze
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }

  if (onProgress) onProgress(1);
  return new Blob(mp3Data, { type: 'audio/mp3' });
}
