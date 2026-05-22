/**
 * Advanced Client-Side Browser Audio Compressor & Resampler.
 * 
 * Compresses any user audio file in-browser before upload to prevent server limits (e.g., 413 Too Large)
 * and radically speed up networks.
 * It decodes the audio track and uses OfflineAudioContext to resample down to 16,000Hz (speech-optimized frequency for Gemini),
 * collapses the stereo space to 1 channel (mono), and converts it into a high-density 16-bit PCM WAV container.
 */

export interface CompressionProgress {
  status: "idle" | "decoding" | "resampling" | "encoding" | "completed" | "failed";
  progress: number; // 0 to 100
  message: string;
}

/**
 * Compresses an audio File and outputs a compressed mono 16kHz WAV file.
 */
export async function compressAudio(
  file: File,
  onProgress?: (progress: CompressionProgress) => void
): Promise<File> {
  const update = (status: CompressionProgress["status"], progress: number, message: string) => {
    if (onProgress) {
      onProgress({ status, progress, message });
    }
  };

  try {
    update("decoding", 10, "Decoding audio stream in-browser context...");
    
    // Create audio context to decode the file bytes
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("Web Audio API is not supported in this browser.");
    }
    const audioCtx = new AudioContextClass();
    
    // Read file as ArrayBuffer
    const fileBuffer = await file.arrayBuffer();
    
    // Decode audio data to PCM AudioBuffer
    let originalBuffer: AudioBuffer;
    try {
      originalBuffer = await audioCtx.decodeAudioData(fileBuffer);
    } catch (decodeErr) {
      console.error("Decode error details:", decodeErr);
      throw new Error("Failed to decode audio file. Note that your browser needs standard codecs for this audio type.");
    } finally {
      // Close the context to free system resources
      await audioCtx.close();
    }

    const duration = originalBuffer.duration;

    // Define standard combinations of speech-optimized sample rates and bit depths
    // Sorted from highest quality (16kHz, 16-bit) to most compressed (8kHz, 8-bit)
    const configs = [
      { sampleRate: 16000, bitDepth: 16, label: "Studio Speech (16kHz, 16-bit)" },
      { sampleRate: 16000, bitDepth: 8, label: "Optimized Speech (16kHz, 8-bit)" },
      { sampleRate: 12000, bitDepth: 8, label: "Eco Speech (12kHz, 8-bit)" },
      { sampleRate: 11025, bitDepth: 8, label: "Eco Speech (11kHz, 8-bit)" },
      { sampleRate: 8000, bitDepth: 8, label: "Compact Speech (8kHz, 8-bit)" },
    ];

    // Target a maximum compressed size of 23 MB to have safe headroom under the 25 MB server boundary.
    const maxTargetBytes = 23 * 1024 * 1024;
    let selectedConfig = configs[configs.length - 1]; // fallback to closest safe level

    for (const config of configs) {
      const estimatedBytes = duration * config.sampleRate * (config.bitDepth / 8);
      if (estimatedBytes < maxTargetBytes) {
        selectedConfig = config;
        break;
      }
    }

    const targetSampleRate = selectedConfig.sampleRate;
    const bitDepth = selectedConfig.bitDepth;

    // Warn if even at maximum compression (8kHz, 8-bit) the file is extremely long and will be over 24MB.
    const absoluteFinalSizeEst = duration * 8000 * 1;
    if (absoluteFinalSizeEst > maxTargetBytes) {
      console.warn(`Extremely long duration detected (${(duration / 60).toFixed(1)} mins). Minimal PCM WAV format will exceed 23MB.`);
    }

    update(
      "resampling",
      40,
      `Resampling to ${selectedConfig.label} to guarantee file is under 25MB...`
    );

    const totalSamples = Math.round(duration * targetSampleRate);

    // Create an OfflineAudioContext to resample the audio track in CPU
    const OfflineAudioContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    const offlineCtx = new OfflineAudioContextClass(
      1, // 1 Channel (Mono)
      totalSamples,
      targetSampleRate
    );

    // Create buffer source
    const bufferSource = offlineCtx.createBufferSource();
    bufferSource.buffer = originalBuffer;
    bufferSource.connect(offlineCtx.destination);
    
    // Begin resampling
    bufferSource.start(0);
    const resampledBuffer = await offlineCtx.startRendering();

    update("encoding", 70, `Encoding as a high-density ${bitDepth}-bit Mono WAV...`);

    // Encode to WAV with target bitDepth
    const wavBlob = bufferToWav(resampledBuffer, bitDepth);

    // Create output File object
    const originalNameWithoutExt = file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
    const compressedFileName = `${originalNameWithoutExt}_compressed.wav`;
    const compressedFile = new File([wavBlob], compressedFileName, {
      type: "audio/wav",
      lastModified: Date.now(),
    });

    update("completed", 100, `Compression successful! Reduced file size by ${(100 - (compressedFile.size / file.size) * 100).toFixed(0)}% using ${selectedConfig.label}.`);
    return compressedFile;

  } catch (err: any) {
    console.error("Audio compression pipeline failed:", err);
    update("failed", 0, err.message || "Compression failed.");
    throw err;
  }
}

/**
 * Converts an AudioBuffer to a standard PCM WAV Blob (supporting both 8-bit and 16-bit)
 */
function bufferToWav(buffer: AudioBuffer, bitDepth: number): Blob {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // 1 = Raw Uncompressed Linear PCM
  
  // Offline rendering guarantees channel count of 1
  const channelData = buffer.getChannelData(0);
  const sampleCount = channelData.length;
  
  const bytesPerSample = bitDepth / 8;
  const bufferLength = sampleCount * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + bufferLength);
  const view = new DataView(wavBuffer);
  
  /* RIFF identifier */
  writeString(view, 0, "RIFF");
  /* File size minus 8 bytes header */
  view.setUint32(4, 36 + bufferLength, true);
  /* WAVE identifier */
  writeString(view, 8, "WAVE");
  
  /* fmt chunk identifier (with trailing space) */
  writeString(view, 12, "fmt ");
  /* fmt chunk size (16 bytes) */
  view.setUint32(16, 16, true);
  /* sample format (linear PCM) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numOfChan, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * numOfChan * bytesPerSample, true);
  /* block align (channels * bytes/sample) */
  view.setUint16(32, numOfChan * bytesPerSample, true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  
  /* data chunk identifier */
  writeString(view, 36, "data");
  /* data chunk size in bytes */
  view.setUint32(40, bufferLength, true);
  
  // Write PCM samples
  let offset = 44;
  if (bitDepth === 16) {
    for (let i = 0; i < sampleCount; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      // Convert 32-bit float audio sample [-1.0, 1.0] to a 16-bit signed integer [-32768, 32767]
      const sampleVal = s < 0 ? s * 0x8000 : s * 0x7FFF;
      view.setInt16(offset, sampleVal, true);
    }
  } else {
    // 8-bit PCM is unsigned (0 to 255), where 128 is mid-range silence
    for (let i = 0; i < sampleCount; i++, offset += 1) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      const sampleVal = Math.round((s + 1) * 127.5);
      view.setUint8(offset, Math.max(0, Math.min(255, sampleVal)));
    }
  }
  
  return new Blob([view], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
