const PCM_BITS_PER_SAMPLE = 16;
const PCM_BYTES_PER_SAMPLE = PCM_BITS_PER_SAMPLE / 8;
const PCM_GAIN = 0.92;
const UINT32_MAX = 0xffffffff;

export interface WavWritableStream {
  write(data: Uint8Array | ArrayBuffer | Blob): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

type SaveFileHandle = {
  createWritable(): Promise<WavWritableStream>;
};

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<SaveFileHandle>;
};

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function toFrameCount(value: number | bigint) {
  if (typeof value === "bigint") {
    if (value < BigInt(0)) {
      throw new RangeError("WAV frame count must be non-negative.");
    }
    return value;
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("WAV frame count must be a non-negative safe integer.");
  }
  return BigInt(value);
}

function validateFormat(sampleRate: number, channels: number) {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError("WAV sample rate must be a positive integer.");
  }
  if (!Number.isInteger(channels) || channels <= 0 || channels > 0xffff) {
    throw new RangeError("WAV channel count must be between 1 and 65535.");
  }

  const blockAlign = channels * PCM_BYTES_PER_SAMPLE;
  const byteRate = sampleRate * blockAlign;
  if (blockAlign > 0xffff || byteRate > UINT32_MAX) {
    throw new RangeError("WAV format exceeds PCM header limits.");
  }

  return { blockAlign, byteRate };
}

/**
 * Creates a PCM WAV header. Files whose RIFF size field would overflow switch
 * automatically to RF64 and carry their 64-bit sizes in a ds64 chunk.
 */
export function createWavHeader(
  totalFrames: number | bigint,
  sampleRate: number,
  channels: number,
): Uint8Array {
  const frames = toFrameCount(totalFrames);
  const { blockAlign, byteRate } = validateFormat(sampleRate, channels);
  const dataBytes = frames * BigInt(blockAlign);
  const riffSize = dataBytes + BigInt(36);

  if (riffSize <= BigInt(UINT32_MAX)) {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);

    writeAscii(view, 0, "RIFF");
    view.setUint32(4, Number(riffSize), true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, PCM_BITS_PER_SAMPLE, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, Number(dataBytes), true);

    return new Uint8Array(header);
  }

  const header = new ArrayBuffer(80);
  const view = new DataView(header);
  const rf64RiffSize = dataBytes + BigInt(72);

  writeAscii(view, 0, "RF64");
  view.setUint32(4, UINT32_MAX, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "ds64");
  view.setUint32(16, 28, true);
  view.setBigUint64(20, rf64RiffSize, true);
  view.setBigUint64(28, dataBytes, true);
  view.setBigUint64(36, frames, true);
  view.setUint32(44, 0, true);
  writeAscii(view, 48, "fmt ");
  view.setUint32(52, 16, true);
  view.setUint16(56, 1, true);
  view.setUint16(58, channels, true);
  view.setUint32(60, sampleRate, true);
  view.setUint32(64, byteRate, true);
  view.setUint16(68, blockAlign, true);
  view.setUint16(70, PCM_BITS_PER_SAMPLE, true);
  writeAscii(view, 72, "data");
  view.setUint32(76, UINT32_MAX, true);

  return new Uint8Array(header);
}

/**
 * Encodes an AudioBuffer range as interleaved little-endian PCM16. The same
 * fixed headroom is applied to every chunk, so independently rendered chunks
 * retain their relative loudness and join without normalization jumps.
 */
export function encodePcm16(
  buffer: AudioBuffer,
  fromFrame: number,
  frameCount: number,
  channels: number,
): Uint8Array {
  if (!Number.isSafeInteger(fromFrame) || fromFrame < 0) {
    throw new RangeError("PCM start frame must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(frameCount) || frameCount < 0) {
    throw new RangeError("PCM frame count must be a non-negative safe integer.");
  }
  if (!Number.isInteger(channels) || channels <= 0 || channels > 0xffff) {
    throw new RangeError("PCM channel count must be between 1 and 65535.");
  }

  const byteLength = frameCount * channels * PCM_BYTES_PER_SAMPLE;
  if (!Number.isSafeInteger(byteLength)) {
    throw new RangeError("PCM chunk is too large to encode in memory.");
  }

  const output = new ArrayBuffer(byteLength);
  const view = new DataView(output);
  const sourceChannels = Array.from(
    { length: buffer.numberOfChannels },
    (_, channel) => buffer.getChannelData(channel),
  );
  let byteOffset = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const sourceFrame = fromFrame + frame;

    for (let channel = 0; channel < channels; channel += 1) {
      let sample = 0;

      if (sourceFrame < buffer.length && sourceChannels.length > 0) {
        if (channels === 1 && sourceChannels.length > 1) {
          for (const source of sourceChannels) {
            sample += source[sourceFrame];
          }
          sample /= sourceChannels.length;
        } else {
          const source = sourceChannels[Math.min(channel, sourceChannels.length - 1)];
          sample = source[sourceFrame];
        }
      }

      const finiteSample = Number.isFinite(sample) ? sample : 0;
      const clamped = Math.max(-1, Math.min(1, finiteSample * PCM_GAIN));
      const integer = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
      view.setInt16(byteOffset, integer, true);
      byteOffset += PCM_BYTES_PER_SAMPLE;
    }
  }

  return new Uint8Array(output);
}

/** Opens the native save picker when the File System Access API is available. */
export async function suggestWavFile(name: string): Promise<WavWritableStream | null> {
  if (typeof window === "undefined") return null;

  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (typeof picker !== "function") return null;

  const baseName = name.trim() || "synesthesia-canvas";
  const safeName = baseName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-");
  const suggestedName = safeName.toLowerCase().endsWith(".wav")
    ? safeName
    : `${safeName}.wav`;
  const handle = await picker.call(window, {
    suggestedName,
    types: [
      {
        description: "WAV 音频",
        accept: { "audio/wav": [".wav"] },
      },
    ],
  });

  return handle.createWritable();
}
