---
name: Arm pose mapping conventions
description: Correct landmark→bone mapping, swing decomposition, and axis negation for TherapistScene arm driving
---

## Rule
Use exactly the same landmark→bone mapping and forearm swing decomposition as AvatarScene.

- Landmark 12,14,16 → lUpperArm, lForeArm (isL=true)
- Landmark 11,13,15 → rUpperArm, rForeArm (isL=false)
- Axis conversion: negate all three axes `-(c.x-p.x), -(c.y-p.y), -(c.z-p.z)`
- Do NOT apply invTorsoQ to arm directions (AvatarScene uses identity quaternion there)
- Forearm uses swing decomposition: `upperSwing = setFromUnitVectors(restData.worldDir, rU)`, then `localFore = rF.applyQuaternion(upperSwing.invert())`
- Right arm (isL=false): negate all three axes of localFore before computeAimTarget
- Call `upper.updateMatrixWorld(true)` after applying the upper arm, before computing the forearm

**Why:** The front-facing video shows landmark 12 (therapist's right) on the LEFT of screen — that must drive lUpperArm so Suzie matches what the viewer sees. The torso lean inverse must NOT be applied to arms (AvatarScene confirmed identity there). Right-arm bone axes are inverted vs left, requiring the forearm negation.

**How to apply:** Any time TherapistScene arm logic is touched, keep all five properties above intact. Changing any one of them causes the dab/bent-arm bug.
