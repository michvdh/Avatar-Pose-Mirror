import { useEffect, useRef } from "react";

interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface PoseResults {
  poseLandmarks?: PoseLandmark[];
}

type OnResultsCallback = (results: PoseResults) => void;
type OnStatusCallback = (status: string) => void;

export function useMediaPipePose(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onResults: OnResultsCallback,
  onStatus?: OnStatusCallback
) {
  const onResultsRef = useRef(onResults);
  onResultsRef.current = onResults;

  useEffect(() => {
    let animFrameId: number;
    let poseInstance: { send: (opts: { image: HTMLVideoElement }) => Promise<void>; close?: () => void } | null = null;
    let stream: MediaStream | null = null;
    let stopped = false;

    async function init() {
      const videoEl = videoRef.current;
      if (!videoEl) return;

      const { Pose } = await import("@mediapipe/pose");

      const pose = new Pose({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
      });

      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      pose.onResults((results: PoseResults) => {
        onResultsRef.current(results);
      });

      poseInstance = pose;

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
        if (video && video.readyState >= 2 && poseInstance) {
          await poseInstance.send({ image: video });
        }
        animFrameId = requestAnimationFrame(loop);
      }

      loop();
    }

    init();

    return () => {
      stopped = true;
      cancelAnimationFrame(animFrameId);
      if (poseInstance?.close) poseInstance.close();
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [videoRef]);
}
