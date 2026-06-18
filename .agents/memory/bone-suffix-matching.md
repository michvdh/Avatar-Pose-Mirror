---
name: Bone suffix matching for dot overlay bones
description: Why dotBonesRef uses endsWith() after stripping non-letters instead of buildBoneStore/findBone for the 6 joint dot positions.
---

`buildBoneStore`'s `findBone` helper matches bone names using simple substring includes() on lowercased names after stripping `[\s_-]` only. This caused a false-match: the keyword `"handr"` (used to find RightHand) matched `mixamorig1LeftHandRing1` because `lefthandring1` contains the substring `handr` and depth-first traversal visits Left arm before Right arm.

**Fix:** `dotBonesRef` (the 6 bones used for pulsing dot positions) is populated at model load using a `findDotBone(suffix)` helper that:
1. Strips ALL non-letter characters: `.replace(/[^a-z]/g, "")` — removes digits too (so `mixamorig1LeftHand` → `mixamoriglefthand`)
2. Uses `endsWith(suffix)` for exact-tail matching

The 6 suffix patterns used: `leftarm`, `rightarm`, `leftforearm`, `rightforearm`, `lefthand`, `righthand`.

**Why endsWith works:** After stripping digits and non-letters, `mixamoriglefthand` ends with `lefthand` but NOT `lefthandindex1` (normalized to `lefthandindex`). This avoids all false-matches in depth-first traversal order.

**How to apply:** Use this pattern for any future "find the exact bone for this joint" task. Do NOT rely on `buildBoneStore`/`findBone` for exact joint identification — it was designed for fuzzy matching and will false-match ring/index fingers when searching for hands.
