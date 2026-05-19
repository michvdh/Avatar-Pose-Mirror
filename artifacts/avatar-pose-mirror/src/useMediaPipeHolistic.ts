import { useEffect, useRef } from "react";

export interface Landmark3D {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface Landmark2D {
  x: number;
  y: number;
  z?: number;
}

export interface HolisticResults {
  poseLandmarks?: Landmark3D[];
  poseWorldLandmarks?: Landmark3D[];
  leftHandLandmarks?: Landmark2D[];
  rightHandLandmarks?: Landmark2D[];
}

type OnResultsCallback = (results: HolisticResults) => void;
type OnStatusCallback = (status: string) => void;

// ── CDN loader ───────────────────────────────────────────────────────────────

// Load MediaPipe Holistic from CDN and cache the constructor on window
// (avoids Vite bundling WASM packages, which is the standard browser pattern)
const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1675471629";

function loadHolisticCDN(): Promise<new (opts: object) => HolisticInstance> {
  type HolisticCtor = new (opts: object) => HolisticInstance;
  const w = window as Window & { Holistic?: HolisticCtor };
  if (w.Holistic) return Promise.resolve(w.Holistic);

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${CDN}/holistic.js`;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      const H = (window as Window & { Holistic?: HolisticCtor }).Holistic;
      H ? resolve(H) : reject(new Error("Holistic not found on window after CDN load"));
    };
    script.onerror = () => reject(new Error("Failed to load MediaPipe Holistic from CDN"));
    document.head.appendChild(script);
  });
}

interface HolisticInstance {
  setOptions(opts: object): void;
  onResults(cb: (results: HolisticResults) => void): void;
  send(opts: { image: HTMLVideoElement }): Promise<void>;
  close?(): void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMediaPipeHolistic(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onResults: OnResultsCallback,
  onStatus?: OnStatusCallback
) {
  const onResultsRef = useRef(onResults);
  onResultsRef.current = onResults;

  useEffect(() => {
    let animFrameId: number;
    let holisticInstance: HolisticInstance | null = null;
    let stream: MediaStream | null = null;
    let stopped = false;

    async function init() {
      const videoEl = videoRef.current;
      if (!videoEl) return;

      let HolisticClass: new (opts: object) => HolisticInstance;
      try {
        HolisticClass = await loadHolisticCDN();
      } catch (err) {
        console.error("MediaPipe CDN load failed:", err);
        onStatus?.("Failed to load pose model");
        return;
      }

      const holistic = new HolisticClass({
        locateFile: (file: string) => `${CDN}/${file}`,
      });

      holistic.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        refineFaceLandmarks: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.7,
      });

      holistic.onResults((results: HolisticResults) => {
        onResultsRef.current(results);
      });

      holisticInstance = holistic;

      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (err) {
        const isDenied =
          err instanceof DOMException &&
          (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
        onStatus?.(isDenied ? "Camera access denied" : "Camera unavailable");
        return;
      }

      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      videoEl.srcObject = stream;
      await videoEl.play();

      async function loop() {
        if (stopped) return;
        const video = videoRef.current;
        if (video && video.readyState >= 2 && holisticInstance) {
          await holisticInstance.send({ image: video });
        }
        animFrameId = requestAnimationFrame(loop);
      }

      loop();
    }

    init();

    return () => {
      stopped = true;
      cancelAnimationFrame(animFrameId);
      if (holisticInstance?.close) holisticInstance.close();
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [videoRef]);
}
