import { useEffect, useRef } from "react";
import type { HolisticResults } from "./useMediaPipeHolistic";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Lm2 { x: number; y: number; visibility?: number }
interface Lm3 { x: number; y: number; z: number; visibility?: number }

interface JointDef {
  id:        string;
  anchorIdx: number; // proximal landmark (e.g. shoulder)
  jointIdx:  number; // distal landmark   (e.g. elbow)
}

// Limb segments to compare: shoulder→elbow and elbow→wrist for both arms
const JOINTS: JointDef[] = [
  { id: "lElbow", anchorIdx: 11, jointIdx: 13 },
  { id: "rElbow", anchorIdx: 12, jointIdx: 14 },
  { id: "lWrist", anchorIdx: 13, jointIdx: 15 },
  { id: "rWrist", anchorIdx: 14, jointIdx: 16 },
];

const OFF_TARGET_DEG = 25;   // show indicator when angular error exceeds this
const ALIGNED_DEG    = 10;   // trigger success when error drops below this
const FADE_MS        = 900;  // checkmark fade-out duration (ms)
const MIN_VIS        = 0.4;
const SMOOTH_ALPHA   = 0.15; // low-pass smoothing factor for error

type JointStatus = "hidden" | "off" | "success";

interface JointState {
  status:     JointStatus;
  successAt:  number;
  dingPlayed: boolean;
  smoothErr:  number;
}

export interface TherapistPoseData {
  image: Lm2[];
  world: Lm3[];
}

interface Props {
  therapistDataRef: React.RefObject<TherapistPoseData | null>;
  patientDataRef:   React.RefObject<HolisticResults | null>;
  active: boolean;
}

// ─── Audio ───────────────────────────────────────────────────────────────────

function playDing() {
  try {
    const ac   = new AudioContext();
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = "sine";
    osc.frequency.value = 880; // A5
    gain.gain.setValueAtTime(0.25, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.4);
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + 0.4);
  } catch { /* no audio context */ }
}

// ─── Math ────────────────────────────────────────────────────────────────────

function sub3(a: Lm3, b: Lm3): Lm3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function norm3(v: Lm3): Lm3 {
  const l = Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
  return l > 1e-6 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: -1, z: 0 };
}
function angleDeg(a: Lm3, b: Lm3): number {
  const d = a.x * b.x + a.y * b.y + a.z * b.z;
  return (Math.acos(Math.min(1, Math.max(-1, d))) * 180) / Math.PI;
}

// ─── Canvas drawing helpers ──────────────────────────────────────────────────

type Pt = { x: number; y: number };

function drawDashedLine(ctx: CanvasRenderingContext2D, a: Pt, b: Pt) {
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = "rgba(40, 160, 255, 0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function drawDonut(ctx: CanvasRenderingContext2D, pos: Pt) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 180, 255, 0.7)";
  ctx.shadowBlur  = 14;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 14, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0, 190, 255, 0.95)";
  ctx.lineWidth   = 3;
  ctx.stroke();
  ctx.restore();
}

function drawPulsingDot(ctx: CanvasRenderingContext2D, pos: Pt, phase: number) {
  // Continuously transitions dark red → bright red → dark red
  const p = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  const r = Math.round(110 + 145 * p);
  const g = Math.round(0   +  55 * p);
  const b = Math.round(0   +  55 * p);
  ctx.save();
  ctx.shadowColor = `rgba(${r},${g},${b},0.7)`;
  ctx.shadowBlur  = 14;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fill();
  ctx.restore();
}

function drawCheckmark(ctx: CanvasRenderingContext2D, pos: Pt, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(0, 255, 136, 0.8)";
  ctx.shadowBlur  = 16;
  ctx.strokeStyle = "#00ff88";
  ctx.lineWidth   = 3.5;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";
  ctx.beginPath();
  ctx.moveTo(pos.x - 10, pos.y + 1);
  ctx.lineTo(pos.x - 2,  pos.y + 9);
  ctx.lineTo(pos.x + 10, pos.y - 7);
  ctx.stroke();
  ctx.restore();
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PoseFeedbackOverlay({
  therapistDataRef,
  patientDataRef,
  active,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Keep canvas pixel resolution in sync with the viewport
    const syncSize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    syncSize();
    window.addEventListener("resize", syncSize);

    // Per-joint state — lives in the rAF closure, no React re-renders needed
    const states = new Map<string, JointState>(
      JOINTS.map(j => [j.id, {
        status: "hidden", successAt: 0, dingPlayed: false, smoothErr: 0,
      }])
    );

    let frameId: number;

    function frame() {
      frameId = requestAnimationFrame(frame);

      const ctx = canvas!.getContext("2d");
      if (!ctx) return;
      const W = canvas!.width;
      const H = canvas!.height;
      ctx.clearRect(0, 0, W, H);

      if (!activeRef.current) return;

      const therapist = therapistDataRef.current;
      const patient   = patientDataRef.current;
      if (
        !therapist?.world || !therapist?.image ||
        !patient?.poseWorldLandmarks || !patient?.poseLandmarks
      ) return;

      const tw  = therapist.world as Lm3[];
      const pw  = patient.poseWorldLandmarks as Lm3[];
      const pi  = patient.poseLandmarks      as Lm2[];
      const now = performance.now();

      for (const joint of JOINTS) {
        const state = states.get(joint.id)!;
        const { anchorIdx, jointIdx } = joint;

        // ── Visibility ───────────────────────────────────────────────────────
        const vis = (l: Lm3 | undefined) => (l?.visibility ?? 1) >= MIN_VIS;
        if (!vis(tw[anchorIdx]) || !vis(tw[jointIdx]) ||
            !vis(pw[anchorIdx]) || !vis(pw[jointIdx])) {
          state.status    = "hidden";
          state.smoothErr = 0;
          continue;
        }

        // ── Angular error in 3-D world space ─────────────────────────────────
        const thDir  = norm3(sub3(tw[jointIdx], tw[anchorIdx]));
        const ptDir  = norm3(sub3(pw[jointIdx], pw[anchorIdx]));
        const errDeg = angleDeg(thDir, ptDir);
        state.smoothErr += SMOOTH_ALPHA * (errDeg - state.smoothErr);

        // ── State machine ─────────────────────────────────────────────────────
        if (state.status === "success") {
          // Let the fade run to completion regardless of current error
          if (now - state.successAt >= FADE_MS) {
            state.status    = "hidden";
            state.dingPlayed = false;
          }
        } else if (state.smoothErr > OFF_TARGET_DEG) {
          state.status = "off";
        } else if (state.smoothErr <= ALIGNED_DEG && state.status === "off") {
          // Was visibly off-target, now aligned → celebrate!
          if (!state.dingPlayed) {
            playDing();
            state.dingPlayed = true;
          }
          state.status    = "success";
          state.successAt = now;
        } else if (state.status !== "off") {
          // In dead-zone and was never shown — stay hidden
          state.status = "hidden";
        }
        // If "off" and in dead-zone: keep showing indicator (hysteresis)

        if (state.status === "hidden") continue;

        // ── Screen positions ─────────────────────────────────────────────────
        // poseLandmarks are raw camera-frame coords (0-1).
        // The canvas uses `transform: scaleX(-1)` (same as SkeletonOverlay)
        // so drawing at raw coords produces the correct mirrored screen position.
        const ptAnchorPx: Pt = { x: pi[anchorIdx].x * W, y: pi[anchorIdx].y * H };
        const ptJointPx:  Pt = { x: pi[jointIdx].x  * W, y: pi[jointIdx].y  * H };

        // Scale = patient's own limb length on screen (robust to camera distance)
        const limbLen = Math.max(40, Math.hypot(
          ptJointPx.x - ptAnchorPx.x,
          ptJointPx.y - ptAnchorPx.y,
        ));

        // Target position = patient's anchor + therapist world-dir → image space.
        // MediaPipe world: X+ = person's left = image X+  (right of frame)
        //                  Y+ = up             = image Y-  (top of frame)
        const targetPx: Pt = {
          x: ptAnchorPx.x + thDir.x * limbLen,
          y: ptAnchorPx.y - thDir.y * limbLen,
        };

        // ── Draw ─────────────────────────────────────────────────────────────
        if (state.status === "success") {
          const alpha = Math.max(0, 1 - (now - state.successAt) / FADE_MS);
          drawCheckmark(ctx, ptJointPx, alpha);
          continue;
        }

        // "off" state: dashed connector + blue donut (target) + pulsing red dot
        const phase = (now / 600) % 1;
        drawDashedLine(ctx, ptJointPx, targetPx);
        drawDonut(ctx, targetPx);
        drawPulsingDot(ctx, ptJointPx, phase);
      }
    }

    frameId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", syncSize);
    };
  }, [therapistDataRef, patientDataRef]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position:      "fixed",
        inset:         0,
        width:         "100%",
        height:        "100%",
        pointerEvents: "none",
        zIndex:        16,
        // Mirror to match Astra's mirrored webcam display (same as SkeletonOverlay)
        transform:     "scaleX(-1)",
      }}
    />
  );
}
