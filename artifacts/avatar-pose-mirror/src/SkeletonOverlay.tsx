import { useEffect, useRef } from "react";
import { HolisticResults, Landmark3D, Landmark2D } from "./useMediaPipeHolistic";

// MediaPipe Holistic pose landmark connections (33 landmarks)
const POSE_CONNECTIONS: [number, number][] = [
  // Face outline
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  // Mouth
  [9, 10],
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  // Right arm
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // Left leg
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  // Right leg
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

// MediaPipe hand landmark connections (21 landmarks per hand)
const HAND_CONNECTIONS: [number, number][] = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [5, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [9, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [13, 17], [17, 18], [18, 19], [19, 20],
  // Palm
  [0, 17],
];

interface Props {
  resultsRef: React.RefObject<HolisticResults | null>;
  visible: boolean;
  width?: number;
  height?: number;
}

export default function SkeletonOverlay({ resultsRef, visible, width = 200, height = 150 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    let frameId: number;

    function draw() {
      frameId = requestAnimationFrame(draw);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const W = canvas.width;
      const H = canvas.height;

      ctx.clearRect(0, 0, W, H);

      const results = resultsRef.current;
      if (!visibleRef.current || !results) return;

      const getVis = (lm: Landmark3D | Landmark2D) =>
        (lm as Landmark3D).visibility ?? 1;

      const drawConnections = (
        lms: (Landmark3D | Landmark2D)[],
        connections: [number, number][],
        r: number, g: number, b: number
      ) => {
        for (const [a, b] of connections) {
          const la = lms[a];
          const lb = lms[b];
          if (!la || !lb) continue;
          const alpha = Math.min(getVis(la), getVis(lb));
          if (alpha < 0.15) continue;
          ctx.beginPath();
          ctx.moveTo(la.x * W, la.y * H);
          ctx.lineTo(lb.x * W, lb.y * H);
          ctx.strokeStyle = `rgba(${r},${g},${b},${alpha * 0.85})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      };

      const drawDots = (
        lms: (Landmark3D | Landmark2D)[],
        r: number, g: number, b: number,
        radius = 2.5
      ) => {
        for (const lm of lms) {
          if (!lm) continue;
          const vis = getVis(lm);
          if (vis < 0.15) continue;
          ctx.beginPath();
          ctx.arc(lm.x * W, lm.y * H, radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r},${g},${b},${vis})`;
          ctx.fill();
        }
      };

      // Pose skeleton — green
      if (results.poseLandmarks) {
        drawConnections(results.poseLandmarks, POSE_CONNECTIONS, 0, 255, 136);
        drawDots(results.poseLandmarks, 255, 255, 255);
      }

      // Right-hand landmarks — amber
      if (results.rightHandLandmarks) {
        drawConnections(results.rightHandLandmarks, HAND_CONNECTIONS, 255, 190, 50);
        drawDots(results.rightHandLandmarks, 255, 190, 50, 2);
      }

      // Left-hand landmarks — blue
      if (results.leftHandLandmarks) {
        drawConnections(results.leftHandLandmarks, HAND_CONNECTIONS, 80, 180, 255);
        drawDots(results.leftHandLandmarks, 80, 180, 255, 2);
      }
    }

    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  }, [resultsRef]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        width,
        height,
        transform: "scaleX(-1)",
        borderRadius: 8,
        pointerEvents: "none",
        zIndex: 11,
      }}
    />
  );
}
