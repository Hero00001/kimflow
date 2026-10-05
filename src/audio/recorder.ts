import { errorDetails, friendlyError } from '../utils';
import { micSelect, micLevel, micLevelFill, statusError } from '../dom';
import { getSettings } from '../store';
import { showError } from '../status';

let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let recordingChunks: Blob[] = [];
let meterContext: AudioContext | null = null;
let meterAnalyser: AnalyserNode | null = null;
let meterData: Uint8Array | null = null;
let meterRaf = 0;

export async function encodeWav(blob: Blob): Promise<ArrayBuffer> {
  const source = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(source.slice(0));
    const targetRate = 16000;
    const frameCount = Math.max(1, Math.ceil(decoded.duration * targetRate));
    const offline = new OfflineAudioContext(1, frameCount, targetRate);
    const sourceNode = offline.createBufferSource();
    sourceNode.buffer = decoded;
    sourceNode.connect(offline.destination);
    sourceNode.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const wav = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(wav);
    const writeString = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, targetRate, true);
    view.setUint32(28, targetRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return wav;
  } finally {
    await audioContext.close();
  }
}

export async function populateMics(): Promise<void> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) {
      throw new Error('Microphone device enumeration is unavailable');
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((device) => device.kind === 'audioinput');
    micSelect.replaceChildren();
    for (const device of audioInputs) {
      const option = document.createElement('option');
      option.value = device.deviceId || 'default';
      option.textContent = device.label || `Microphone ${device.deviceId.slice(0, 8)}`;
      micSelect.appendChild(option);
    }
    if (!micSelect.options.length) {
      micSelect.append(new Option('Default Microphone', 'default'));
    }
    const selected = getSettings()?.microphone;
    if (selected && [...micSelect.options].some((option) => option.value === selected)) {
      micSelect.value = selected;
    }
  } catch {
    micSelect.replaceChildren(new Option('Default Microphone', 'default'));
  }
}

async function requestAudioStream(microphone: string): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is unavailable in this window');
  }
  const audio: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
  };
  if (microphone && microphone !== 'default') {
    audio.deviceId = { exact: microphone };
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio });
  } catch (error) {
    // A stale device ID should not prevent use of the default microphone.
    if (audio.deviceId) {
      delete audio.deviceId;
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio });
    } else {
      throw error;
    }
  }
  try {
    stopMeter();
    meterContext = new AudioContext();
    const source = meterContext.createMediaStreamSource(mediaStream);
    meterAnalyser = meterContext.createAnalyser();
    meterAnalyser.fftSize = 512;
    meterData = new Uint8Array(meterAnalyser.fftSize);
    source.connect(meterAnalyser);
  } catch {
    stopMeter();
  }
  await populateMics();
}

export function meterWidth(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(rms * 140)));
}

function stopMeter() {
  if (meterRaf) {
    cancelAnimationFrame(meterRaf);
    meterRaf = 0;
  }
  if (meterContext) {
    void meterContext.close().catch(() => undefined);
    meterContext = null;
  }
  meterAnalyser = null;
  meterData = null;
  micLevelFill.style.width = '0%';
  micLevelFill.classList.remove('hot');
  micLevel.classList.add('hidden');
}

function tickMeter() {
  meterRaf = 0;
  if (!meterAnalyser || !meterData || !mediaRecorder || mediaRecorder.state !== 'recording') return;
  meterAnalyser.getByteTimeDomainData(meterData);
  let sum = 0;
  for (let i = 0; i < meterData.length; i += 1) {
    const sample = (meterData[i] - 128) / 128;
    sum += sample * sample;
  }
  const width = meterWidth(Math.sqrt(sum / meterData.length));
  micLevelFill.style.width = `${width}%`;
  micLevelFill.classList.toggle('hot', width >= 95);
  meterRaf = requestAnimationFrame(tickMeter);
}

function startMeter() {
  if (!meterAnalyser) return;
  micLevel.classList.remove('hidden');
  if (!meterRaf) tickMeter();
}

function stopTracks() {
  stopMeter();
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
}

export function pauseCapture() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') throw new Error('Audio recording is not active');
  mediaRecorder.pause();
  micLevel.classList.add('hidden');
}

export function resumeCapture() {
  if (!mediaRecorder || mediaRecorder.state !== 'paused') throw new Error('Audio recording is not paused');
  mediaRecorder.resume();
  startMeter();
}

export function captureState(): RecordingState | undefined {
  return mediaRecorder?.state;
}

export function abortCapture() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.ondataavailable = null;
    mediaRecorder.onerror = null;
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
  }
  mediaRecorder = null;
  recordingChunks = [];
  stopTracks();
}

let micWatchCleanup: (() => void) | null = null;

// A microphone unplug pauses the capture — it never cancels or discards
// audio. The handler is idempotent and tolerates repeated devicechange
// events: only an actively-recording capture is paused, so follow-up events
// while already paused are harmless no-ops.
export function watchMicDeviceChanges(onUnplugged?: () => void): () => void {
  if (micWatchCleanup) return micWatchCleanup;
  const noop = () => undefined;
  const mediaDevices = navigator.mediaDevices as
    | (MediaDevices & { addEventListener?: MediaDevices['addEventListener']; removeEventListener?: MediaDevices['removeEventListener'] })
    | undefined;
  if (typeof mediaDevices?.addEventListener !== 'function') return noop;
  const handler = () => {
    void populateMics();
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try {
        pauseCapture();
      } catch {
        return;
      }
      try {
        onUnplugged?.();
      } catch {
        // Backend pause sync is best-effort; capture is already paused.
      }
    }
  };
  mediaDevices.addEventListener('devicechange', handler);
  micWatchCleanup = () => {
    try {
      mediaDevices.removeEventListener?.('devicechange', handler);
    } catch {
      // Listener removal is best-effort.
    }
    micWatchCleanup = null;
  };
  return micWatchCleanup;
}

export async function startCapture(microphone: string): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('This system does not support microphone recording');
  }
  await requestAudioStream(microphone);
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  recordingChunks = [];
  mediaRecorder = new MediaRecorder(mediaStream!, { mimeType });
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) recordingChunks.push(event.data);
  };
  mediaRecorder.start();
  startMeter();
}

export async function stopCapture(): Promise<ArrayBuffer> {
  const recorder = mediaRecorder;
  if (!recorder) throw new Error('Audio recording is not active');

  const webm = await new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(recordingChunks, { type: recorder.mimeType }));
    recorder.onerror = () => reject(new Error('Microphone recording failed'));
    if (recorder.state !== 'inactive') recorder.stop();
    else resolve(new Blob(recordingChunks, { type: recorder.mimeType }));
  });

  mediaRecorder = null;
  stopTracks();
  recordingChunks = [];
  try {
    return await encodeWav(webm);
  } catch (error) {
    throw new Error(`Unable to decode microphone audio: ${friendlyError(error, 'unsupported audio format')}`);
  }
}

export async function requestMicPermission(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    showError('Microphone access is unavailable in this Electron window');
    return;
  }
  try {
    const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    permissionStream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    const friendly = friendlyError(error, 'Microphone permission was not granted');
    if (friendly) showError(friendly);
    statusError.title = errorDetails(error) ?? '';
  }
}