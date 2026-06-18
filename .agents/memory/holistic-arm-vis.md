---
name: Holistic arm visibility gating
description: MediaPipe Holistic arm landmark visibility behaviour when arms are at sides vs raised; isVis threshold explanation.
---

When a user sits with arms resting at their sides, MediaPipe Holistic poseLandmarks visibility scores for elbows and wrists typically land in the 0.05–0.30 range. This is expected — the joints are partially occluded by the body or near the frame edges.

When the user raises or extends their arms, visibility jumps immediately to 0.70–0.96.

**Why:** `applyArmChain` in `computeTargets` gates on `isVis(lm) = lm.visibility >= 0.3`. When arms are at sides and visibility < 0.3, the arm chain returns early and Astra stays at rest pose. This is intentional — landmark positions at 0.05 confidence are essentially noise and would cause wild jitter if accepted.

**How to apply:** If users report "Astra not moving", first check arm visibility via the diagnostic pattern (temporarily log `imgLm[13|14|15|16].visibility` inside `computeTargets`). If all elbows/wrists read < 0.3 while user sits still, the system is working correctly — Astra mirrors intentional arm movements only. Tell the user to raise or extend their arms.

The threshold 0.3 in `isVis` is a deliberate quality gate, NOT a bug. Lowering it (e.g. to 0.1) would cause jitter when arms are at sides; raising it (e.g. to 0.5) would be too strict.

`minTrackingConfidence: 0.7` in `useMediaPipeHolistic.ts` is the holistic detector's re-detection threshold, separate from the per-landmark visibility field.
