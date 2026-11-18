import {
  createGateway,
  experimental_encodeRealtimeAudio as encodeAudio,
  experimental_resampleAudio as resampleAudio,
  experimental_streamTranscribe as streamTranscribe,
} from "ai";
import type { StreamTranscriptionResult } from "ai";
import { DICTATION_MODEL } from "#shared/chat-dictation";

const SAMPLE_RATE = 24_000;
const RECORDING_TYPES = ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus"];

interface Capture {
  recorder: MediaRecorder;
  clip: Promise<Blob | undefined>;
}

interface Recording {
  abort: AbortController;
  liveAbort: AbortController;
  context?: AudioContext;
  microphone?: MediaStream;
  capture?: Capture;
  result?: StreamTranscriptionResult;
  audio?: ReadableStreamDefaultController<string>;
  processor?: ScriptProcessorNode;
  timer?: ReturnType<typeof setTimeout>;
}

function captureAudio(microphone: MediaStream): Capture | undefined {
  if (typeof MediaRecorder === "undefined") return;

  const mimeType = RECORDING_TYPES.find(type => MediaRecorder.isTypeSupported(type));
  try {
    const recorder = new MediaRecorder(microphone, { mimeType, audioBitsPerSecond: 64_000 });
    const chunks: Blob[] = [];
    const clip = new Promise<Blob | undefined>((resolve) => {
      recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
      recorder.onstop = () => {
        resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type }) : undefined);
      };
      recorder.onerror = () => resolve(undefined);
    });
    recorder.start();
    return { recorder, clip };
  }
  catch {
    // Browsers without a usable recorder can still use the live audio path.
  }
}

function openAudioContext(): AudioContext | undefined {
  if (typeof AudioContext === "undefined") return;
  try { return new AudioContext(); }
  catch { /* Recording can still work without Web Audio. */ }
}

export function useDictation() {
  const supported = ref(false);
  const stage = ref<"idle" | "starting" | "recording" | "finishing">("idle");
  const preview = ref("");
  const volume = ref(0);
  let active: Recording | undefined;

  onMounted(() => {
    supported.value = Boolean(navigator.mediaDevices?.getUserMedia)
      && (typeof AudioContext !== "undefined" || typeof MediaRecorder !== "undefined");
  });

  function closeLiveInput(recording: Recording) {
    if (recording.processor) recording.processor.onaudioprocess = null;
    if (recording.context?.state !== "closed") void recording.context?.close().catch(() => {});
    try { recording.audio?.close(); }
    catch { /* The transport may have already closed the audio stream. */ }
    recording.audio = undefined;
  }

  function release(recording: Recording) {
    clearTimeout(recording.timer);
    if (recording.capture?.recorder.state === "recording") recording.capture.recorder.stop();
    recording.microphone?.getTracks().forEach(track => track.stop());
    closeLiveInput(recording);
  }

  function reset(recording: Recording) {
    if (active !== recording) return;
    active = undefined;
    stage.value = "idle";
    preview.value = "";
    volume.value = 0;
  }

  function cancel() {
    if (!active) return;
    const recording = active;
    recording.abort.abort();
    recording.liveAbort.abort();
    release(recording);
    reset(recording);
  }

  function liveFailed(recording: Recording, error: unknown, fail: (cause: unknown) => void) {
    if (active !== recording || stage.value !== "recording") return;

    recording.result = undefined;
    recording.liveAbort.abort();
    if (recording.capture) {
      preview.value = "";
      return;
    }
    cancel();
    fail(error);
  }

  async function trackTranscript(recording: Recording, result: StreamTranscriptionResult) {
    const completed: string[] = [];
    let partial = "";
    for await (const part of result.fullStream) {
      if (part.type === "transcript-delta") partial += part.delta;
      if (part.type === "transcript-partial") partial = part.text;
      if (part.type === "transcript-final") {
        completed.push(part.text);
        partial = "";
      }
      if (part.type === "error") throw part.error;
      if (active === recording) preview.value = [...completed, partial].join(" ").trim();
    }
    if (active === recording && stage.value === "recording") {
      throw new Error("The live transcription connection ended.");
    }
  }

  async function streamRecording(recording: Recording, microphone: MediaStream, resumed: Promise<boolean>) {
    const context = recording.context;
    const signal = recording.liveAbort.signal;
    if (!context || !await resumed) throw new Error("Live microphone audio is unavailable.");
    if (signal.aborted || stage.value !== "recording") return;

    const audio = new ReadableStream<string>({
      start(controller) { recording.audio = controller; },
    });
    const source = context.createMediaStreamSource(microphone);
    const processor = context.createScriptProcessor(4096, 1, 1);
    recording.processor = processor;
    const mute = context.createGain();
    mute.gain.value = 0;

    processor.onaudioprocess = (event) => {
      const samples = new Float32Array(event.inputBuffer.getChannelData(0));
      const power = samples.reduce((sum, sample) => sum + sample * sample, 0);
      volume.value = Math.min(1, Math.sqrt(power / samples.length) * 5);

      if (signal.aborted || !recording.audio) return;
      const mono = context.sampleRate === SAMPLE_RATE
        ? samples
        : resampleAudio(samples, context.sampleRate, SAMPLE_RATE);
      try { recording.audio.enqueue(encodeAudio(mono)); }
      catch { recording.audio = undefined; }
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);

    const { token } = await $fetch<{ token: string }>("/api/transcription/token", {
      method: "POST", body: {}, signal, timeout: 6_000, retry: 0,
    });
    if (signal.aborted || stage.value !== "recording") return;

    const model = createGateway({ apiKey: token }).experimental_transcription(DICTATION_MODEL);
    const result = streamTranscribe({ model, audio, inputAudioFormat: { type: "audio/pcm", rate: SAMPLE_RATE }, abortSignal: signal });
    recording.result = result;
    await trackTranscript(recording, result);
  }

  async function begin(onLimit: () => void, fail: (error: unknown) => void) {
    if (active || !supported.value) return;

    const context = openAudioContext();
    const recording: Recording = { abort: new AbortController(), liveAbort: new AbortController(), context };
    active = recording;
    stage.value = "starting";

    try {
      // Unlock Web Audio during the click, without making iPad microphone
      // recording depend on whether Safari resumes the audio context.
      const resumed = context?.resume().then(() => true, () => false) ?? Promise.resolve(false);
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (recording.abort.signal.aborted) {
        microphone.getTracks().forEach(track => track.stop());
        return;
      }

      recording.microphone = microphone;
      recording.capture = captureAudio(microphone);
      if (!context && !recording.capture) throw new Error("Microphone recording is unavailable.");
      recording.timer = setTimeout(onLimit, 120_000);
      stage.value = "recording";
      void streamRecording(recording, microphone, resumed).catch(error => liveFailed(recording, error, fail));
    }
    catch (error) {
      if (recording.abort.signal.aborted) return;
      cancel();
      throw error;
    }
  }

  async function recordedTranscript(recording: Recording) {
    const clip = await recording.capture?.clip;
    if (active !== recording || !clip?.size) return "";

    const { transcript } = await $fetch<{ transcript: string }>("/api/transcription/recording", {
      method: "POST",
      body: clip,
      headers: { "content-type": clip.type },
      signal: recording.abort.signal,
      timeout: 30_000,
      retry: 0,
    });
    return transcript;
  }

  async function finish() {
    const recording = active;
    if (!recording || stage.value !== "recording") return "";

    stage.value = "finishing";
    const live = recording.result;
    if (!live) recording.liveAbort.abort();
    release(recording);

    try {
      if (live) {
        const deadline = setTimeout(() => recording.liveAbort.abort(), recording.capture ? 5_000 : 15_000);
        try {
          const text = (await live.text).trim();
          if (text || !recording.capture) return active === recording ? text : "";
        }
        catch (error) {
          if (!recording.capture) throw error;
        }
        finally {
          clearTimeout(deadline);
        }
      }
      return await recordedTranscript(recording);
    }
    catch (error) {
      if (active === recording) throw error;
      return "";
    }
    finally {
      reset(recording);
    }
  }

  onScopeDispose(cancel);
  return { supported, stage, preview, volume, begin, cancel, finish };
}
