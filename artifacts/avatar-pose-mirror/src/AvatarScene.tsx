import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  useMediaPipeHolistic,
  HolisticResults,
  Landmark3D,
  Landmark2D,
} from "./useMediaPipeHolistic";
import {
  findBone,
  captureArmRestData,
  captureEulerRestData,
  BoneRestData,
  computeAimTarget,
  slerpBone,
} from "./boneUtils";
import SkeletonOverlay from "./SkeletonOverlay";

// ─── Types ─────────────────────────────────────────────────────────────────

type FingerBones = [THREE.Bone | null, THREE.Bone | null, THREE.Bone | null];
type HandFingers = [FingerBones, FingerBones, FingerBones, FingerBones, FingerBones];

interface BoneStore {
  root: THREE.Object3D;
  hips: THREE.Bone | null;
  spine: THREE.Bone | null;
  spine1: THREE.Bone | null;
  neck: THREE.Bone | null;
  head: THREE.Bone | null;
  // Clavicles / shoulders — elevate with arm raise
  lShoulder: THREE.Bone | null;
  rShoulder: THREE.Bone | null;
  // Avatar LEFT (visual RIGHT) – driven by user's RIGHT side
  lUpperArm: THREE.Bone | null;
  lForeArm: THREE.Bone | null;
  lHand: THREE.Bone | null;
  lFingers: HandFingers;
  // Avatar RIGHT (visual LEFT) – driven by user's LEFT side
  rUpperArm: THREE.Bone | null;
  rForeArm: THREE.Bone | null;
  rHand: THREE.Bone | null;
  rFingers: HandFingers;
  // Legs — Avatar LEFT driven by user's RIGHT leg; Avatar RIGHT by user's LEFT leg
  lThigh: THREE.Bone | null;
  rThigh: THREE.Bone | null;
  lCalf: THREE.Bone | null;
  rCalf: THREE.Bone | null;
  lFoot: THREE.Bone | null;
  rFoot: THREE.Bone | null;
}

// ─── Bone discovery ────────────────────────────────────────────────────────

// Side-specific keyword: use the first letter immediately before a keyword
// AccuRig names: thumb_01_l → "thumb01l", index_02_r → "index02r"
// CC_Base names: CC_Base_L_Thumb1 → "ccbaselthumb1"
function finger(root: THREE.Object3D, side: string, name: string): FingerBones {
  const s = side[0]; // "l" or "r"
  const f = (n: number) =>
    findBone(root, [
      [`${name}0${n}${s}`],         // AccuRig: thumb01l, index02r, middle03l
      [`${s}${name}${n}`],          // CC_Base: lthumb1, rindex2
      [`${side}hand${name}${n}`],   // Mixamo: lefthandthumb1
      [`${name}${n}`, s, "hand"],   // broad fallback
    ]);
  return [f(1), f(2), f(3)];
}

function buildBoneStore(root: THREE.Object3D): BoneStore {
  const fb = (sets: string[][]) => findBone(root, sets);

  // Dump all bone names once so mapping can be verified in the console
  const allBones: string[] = [];
  root.traverse(obj => { if (obj instanceof THREE.Bone) allBones.push(obj.name); });
  console.log("[bones] hierarchy:", allBones.join(", "));

  const store: BoneStore = {
    root,
    // AccuRig: pelvis | CC_Base: hips/hip
    hips:   fb([["pelvis"], ["hips"], ["hip"]]),
    // AccuRig: spine_01→"spine01" | CC_Base: spine01/spine
    spine:  fb([["spine01"], ["spine1"], ["spine"], ["torso"]]),
    // AccuRig: spine_02→"spine02" | CC_Base: spine02/chest
    spine1: fb([["spine02"], ["spine2"], ["chest"], ["upperchest"]]),
    // AccuRig: neck_01→"neck01" | CC_Base: neck
    neck:   fb([["neck01"], ["neck"]]),
    head:   fb([["head"]]),
    // AccuRig: clavicle_l→"claviclel" | CC_Base: lclavicle
    // NOTE: "clavicle_l" stripped = c,l,a,v,i,c,l,e,l = "claviclel" (l-e-l at end)
    //       NOT "clavicell" (e-l-l) — 'l' comes before 'e' in "clavicle".
    lShoulder: fb([["claviclel"], ["lclavicle"], ["lshoulder"], ["leftclavicle"]]),
    rShoulder: fb([["clavicler"], ["rclavicle"], ["rshoulder"], ["rightclavicle"]]),
    // AccuRig: upperarm_l→"upperarml" | CC_Base: lupperarm
    lUpperArm: fb([["upperarml"], ["lupperarm"], ["leftupperarm"]]),
    // AccuRig: lowerarm_l→"lowerarml" | CC_Base: lforearm
    lForeArm:  fb([["lowerarml"], ["lforearm"],  ["leftforearm"]]),
    // AccuRig: hand_l→"handl" | CC_Base: lhand  (traversal hits hand_l before ik_hand_l)
    lHand:     fb([["handl"],     ["lhand"],      ["lefthand"]]),
    lFingers: [
      finger(root, "left", "thumb"),
      finger(root, "left", "index"),
      finger(root, "left", "middle"),
      finger(root, "left", "ring"),
      finger(root, "left", "pinky"),
    ],
    // AccuRig: upperarm_r→"upperarmr" | CC_Base: rupperarm
    rUpperArm: fb([["upperarmr"], ["rupperarm"], ["rightupperarm"]]),
    rForeArm:  fb([["lowerarmr"], ["rforearm"],  ["rightforearm"]]),
    rHand:     fb([["handr"],     ["rhand"],      ["righthand"]]),
    rFingers: [
      finger(root, "right", "thumb"),
      finger(root, "right", "index"),
      finger(root, "right", "middle"),
      finger(root, "right", "ring"),
      finger(root, "right", "pinky"),
    ],
    // AccuRig: thigh_l→"thighl", calf_l→"calfl", foot_l→"footl"
    lThigh: fb([["thighl"], ["leftthigh"], ["lupleg"]]),
    rThigh: fb([["thighr"], ["rightthigh"], ["rupleg"]]),
    lCalf:  fb([["calfl"],  ["leftcalf"],  ["lleg"]]),
    rCalf:  fb([["calfr"],  ["rightcalf"], ["rleg"]]),
    lFoot:  fb([["footl"],  ["leftfoot"]]),
    rFoot:  fb([["footr"],  ["rightfoot"]]),
  };

  // Debug log
  const report = (label: string, b: THREE.Bone | null) =>
    console.log(`[bones] ${label}: ${b?.name ?? "NOT FOUND"}`);
  report("hips", store.hips); report("spine", store.spine); report("spine1", store.spine1);
  report("neck", store.neck); report("head", store.head);
  report("lShoulder", store.lShoulder); report("rShoulder", store.rShoulder);
  report("lUpperArm", store.lUpperArm); report("lForeArm", store.lForeArm); report("lHand", store.lHand);
  report("rUpperArm", store.rUpperArm); report("rForeArm", store.rForeArm); report("rHand", store.rHand);
  const lIdx = store.lFingers[1]; const rIdx = store.rFingers[1];
  console.log(`[bones] lIndex: ${lIdx[0]?.name ?? "?"} / ${lIdx[1]?.name ?? "?"} / ${lIdx[2]?.name ?? "?"}`);
  console.log(`[bones] rIndex: ${rIdx[0]?.name ?? "?"} / ${rIdx[1]?.name ?? "?"} / ${rIdx[2]?.name ?? "?"}`);
  report("lThigh", store.lThigh); report("rThigh", store.rThigh);
  report("lCalf", store.lCalf);   report("rCalf", store.rCalf);
  report("lFoot", store.lFoot);   report("rFoot", store.rFoot);

  return store;
}

// ─── Rest-data capture ─────────────────────────────────────────────────────

function captureRestData(store: BoneStore): Map<THREE.Bone, BoneRestData> {
  const map = new Map<THREE.Bone, BoneRestData>();
  const chain = (a: THREE.Bone | null, b: THREE.Bone | null) => {
    if (a && b) map.set(a, captureArmRestData(a, b));
  };
  const euler = (b: THREE.Bone | null) => { if (b) map.set(b, captureEulerRestData(b)); };

  euler(store.hips); euler(store.spine); euler(store.spine1);
  euler(store.neck); euler(store.head);
  euler(store.lShoulder); euler(store.rShoulder);

  chain(store.lUpperArm, store.lForeArm);
  chain(store.lForeArm, store.lHand);
  // Hand bone: aim toward middle-finger proximal (or index if no middle)
  chain(store.lHand, store.lFingers[2][0] ?? store.lFingers[1][0]);
  chain(store.rUpperArm, store.rForeArm);
  chain(store.rForeArm, store.rHand);
  chain(store.rHand, store.rFingers[2][0] ?? store.rFingers[1][0]);

  // Legs — thigh aims at calf (knee), calf aims at foot (ankle)
  chain(store.lThigh, store.lCalf);
  chain(store.rThigh, store.rCalf);
  chain(store.lCalf, store.lFoot);
  chain(store.rCalf, store.rFoot);

  // Foot bones: aim toward first child toe bone if present, else use local +X world direction
  const captureFoot = (b: THREE.Bone | null) => {
    if (!b) return;
    const toeBone = b.children.find((c) => c instanceof THREE.Bone) as THREE.Bone | undefined;
    if (toeBone) {
      map.set(b, captureArmRestData(b, toeBone));
    } else {
      const wq = b.getWorldQuaternion(new THREE.Quaternion());
      const worldDir = new THREE.Vector3(1, 0, 0).applyQuaternion(wq).normalize();
      map.set(b, { localQuat: b.quaternion.clone(), worldDir });
    }
  };
  captureFoot(store.lFoot);
  captureFoot(store.rFoot);

  for (const hand of [store.lFingers, store.rFingers]) {
    for (const fg of hand) {
      chain(fg[0], fg[1]);
      chain(fg[1], fg[2]);
      // Distal bone (fg[2]): try real tip child, else extrapolate from bone's local +X
      const distal = fg[2];
      if (distal && !map.has(distal)) {
        const tipChild = distal.children.find((c) => c instanceof THREE.Bone) as THREE.Bone | undefined;
        if (tipChild) {
          map.set(distal, captureArmRestData(distal, tipChild));
        } else {
          const wq = distal.getWorldQuaternion(new THREE.Quaternion());
          const worldDir = new THREE.Vector3(1, 0, 0).applyQuaternion(wq).normalize();
          map.set(distal, { localQuat: distal.quaternion.clone(), worldDir });
        }
      }
    }
  }
  return map;
}

// ─── Landmark helpers ──────────────────────────────────────────────────────
//
// MediaPipe coordinate conventions (critical for sign decisions):
//
//  poseLandmarks (image-space, used here):
//    X  — normalized [0,1], increases LEFT→RIGHT in image
//    Y  — normalized [0,1], increases TOP→BOTTOM in image  (Y is DOWN)
//    Z  — depth in the same scale as X, origin at hip midpoint.
//         NEGATIVE = closer to camera / in front of the body.
//         POSITIVE = further from camera / behind the body.
//
//  Landmark indices follow the PERSON's left/right (not camera left/right).
//  In an unmirrored feed, the person's LEFT shoulder (idx 11) appears on the
//  RIGHT side of the image, so ls.x > rs.x when the user faces the camera.
//
//  poseWorldLandmarks (world-space, fallback):
//    X  — increases LEFT→RIGHT (same as image)
//    Y  — world-up (opposite of image Y)
//    Z  — same depth convention as poseLandmarks
//
//  Consequence for Z-based lean/tilt formulas:
//    • Leaning FORWARD → shoulders come CLOSER to camera → shMidZ DECREASES.
//      Use -(shMidZ - hipMidZ) so forward lean yields a positive rotation.
//    • Tilting chin FORWARD → nose comes CLOSER → nose.z DECREASES.
//      Use -(nose.z - shMidZ) so chin-forward yields a positive rotation.

const isVis = (lm: Landmark3D) => (lm.visibility ?? 1) >= 0.3;

// poseWorldLandmarks: Y already up, negate X for mirror
function worldDir(child: Landmark3D, parent: Landmark3D): THREE.Vector3 {
  return new THREE.Vector3(
    -(child.x - parent.x),
     (child.y - parent.y),
     (child.z - parent.z)
  ).normalize();
}

// poseLandmarks: image-space (Y down, X right).
// Negate X (mirror), Y (image-down→world-up), AND Z:
//   poseLandmarks Z: negative=closer to camera.
//   Three.js Z: positive=toward viewer (camera).
//   Negating makes "reaching forward" produce a positive Three.js Z direction.
function poseDir(child: Landmark3D, parent: Landmark3D): THREE.Vector3 {
  return new THREE.Vector3(
    -(child.x - parent.x),
    -(child.y - parent.y),
    -(child.z - parent.z)
  ).normalize();
}

// 2D hand landmarks: negate both X (mirror) and Y (image-down → world-up)
// Include Z (relative wrist depth) so directions stay 3D-stable when fingers
// point toward / away from the camera.
function handDir(child: Landmark2D, parent: Landmark2D): THREE.Vector3 {
  return new THREE.Vector3(
    -(child.x - parent.x),
    -(child.y - parent.y),
    (child.z ?? 0) - (parent.z ?? 0)
  ).normalize();
}

const FINGER_PAIRS: [number, number][][] = [
  [[1, 2], [2, 3], [3, 4]],
  [[5, 6], [6, 7], [7, 8]],
  [[9, 10], [10, 11], [11, 12]],
  [[13, 14], [14, 15], [15, 16]],
  [[17, 18], [18, 19], [19, 20]],
];

// ─── Target computation ────────────────────────────────────────────────────

function computeTargets(
  data: HolisticResults,
  store: BoneStore,
  restData: Map<THREE.Bone, BoneRestData>
): Map<THREE.Bone, THREE.Quaternion> {
  const targets = new Map<THREE.Bone, THREE.Quaternion>();
  const set = (bone: THREE.Bone | null, rest: BoneRestData | undefined, dir: THREE.Vector3) => {
    if (bone && rest) targets.set(bone, computeAimTarget(bone, rest, dir));
  };

  // Prefer poseLandmarks (always populated) over poseWorldLandmarks (unreliable on CDN builds)
  const wl = data.poseLandmarks ?? data.poseWorldLandmarks;
  // poseLandmarks uses image-space Y (down); poseWorldLandmarks uses world-space Y (up).
  // ySign corrects denominators and heights so formulas stay identical.
  const isImgSpace = !!data.poseLandmarks;
  const ySign = isImgSpace ? -1 : 1;
  // Direction function: poseDir negates Y (image→world); worldDir leaves Y alone.
  const dirFn = isImgSpace ? poseDir : worldDir;

  // Mirror: user RIGHT → avatar LeftHand (visual right); user LEFT → avatar RightHand (visual left)
  const rhLms = data.rightHandLandmarks; // user RIGHT → avatar lFingers
  const lhLms = data.leftHandLandmarks;  // user LEFT  → avatar rFingers

  if (wl && wl.length >= 25) {
    const ls = wl[11], rs = wl[12]; // left/right shoulders
    const lh = wl[23], rh = wl[24]; // left/right hips

    // ── Pelvis locked at rest — yaw goes to spine so legs stay planted ─
    if (store.hips) {
      const rest = restData.get(store.hips);
      if (rest) targets.set(store.hips, rest.localQuat.clone());
    }

    // ── Spine: yaw (torso twist) + forward lean combined ───────────────
    // Yaw is applied here instead of hips so the thigh/leg bones (children
    // of pelvis, not spine) don't rotate — feet stay planted.
    if (store.spine && isVis(ls) && isVis(rs) && isVis(lh) && isVis(rh)) {
      const dx = rs.x - ls.x;
      const dz = rs.z - ls.z;
      const yaw = Math.atan2(dz, -dx) * 0.65;

      const shMidZ = (ls.z + rs.z) / 2;
      const hipMidZ = (lh.z + rh.z) / 2;
      const shMidY = (ls.y + rs.y) / 2;
      const hipMidY = (lh.y + rh.y) / 2;
      // Negate Z delta: smaller Z = closer to camera; leaning forward → shMidZ drops → positive lean.
      const forwardLean = Math.atan2(-(shMidZ - hipMidZ), Math.max(0.01, ySign * (shMidY - hipMidY))) * 0.5;

      const rest = restData.get(store.spine)!;
      const yawQ  = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const leanQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), forwardLean);
      targets.set(store.spine, rest.localQuat.clone().multiply(yawQ).multiply(leanQ));
    }

    // ── Spine1 lateral lean from shoulder vs hip X midpoint offset ─────
    if (store.spine1 && isVis(ls) && isVis(rs) && isVis(lh) && isVis(rh)) {
      const shMidX = (ls.x + rs.x) / 2;
      const hipMidX = (lh.x + rh.x) / 2;
      const shMidY = (ls.y + rs.y) / 2;
      const hipMidY = (lh.y + rh.y) / 2;
      const lateralLean = Math.atan2(shMidX - hipMidX, Math.max(0.01, ySign * (shMidY - hipMidY))) * 0.4;
      const rest = restData.get(store.spine1)!;
      targets.set(
        store.spine1,
        rest.localQuat.clone().multiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -lateralLean)
        )
      );
    }

    // ── Visibility gatekeeper: all four elbows/wrists must be clear ────
    // If any limb is partially occluded, skip the entire arm+clavicle block
    // to avoid the avatar snapping to bad poses on partial visibility frames.
    const armVis =
      (wl[13]?.visibility ?? 0) >= 0.65 &&  // left elbow
      (wl[14]?.visibility ?? 0) >= 0.65 &&  // right elbow
      (wl[15]?.visibility ?? 0) >= 0.65 &&  // left wrist
      (wl[16]?.visibility ?? 0) >= 0.65;    // right wrist

    if (armVis) {
      // ── Clavicle elevation from arm raise ────────────────────────────
      // Avatar LEFT clavicle driven by user's RIGHT shoulder/elbow (mirrored)
      if (store.lShoulder && isVis(rs) && isVis(wl[14])) {
        const elevation = Math.max(-0.25, Math.min(0.45, (wl[14].y - rs.y) * ySign * -1.2));
        const rest = restData.get(store.lShoulder)!;
        targets.set(
          store.lShoulder,
          rest.localQuat.clone().multiply(
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), elevation)
          )
        );
      }
      // Avatar RIGHT clavicle driven by user's LEFT shoulder/elbow
      if (store.rShoulder && isVis(ls) && isVis(wl[13])) {
        const elevation = Math.max(-0.25, Math.min(0.45, (wl[13].y - ls.y) * ySign * -1.2));
        const rest = restData.get(store.rShoulder)!;
        targets.set(
          store.rShoulder,
          rest.localQuat.clone().multiply(
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -elevation)
          )
        );
      }

      // ── Arms ─────────────────────────────────────────────────────────
      // Avatar LEFT arm ← user's RIGHT arm (MP: shoulder=12, elbow=14, wrist=16)
      if (isVis(rs) && isVis(wl[14]))
        set(store.lUpperArm, restData.get(store.lUpperArm!), dirFn(wl[14], rs));
      if (isVis(wl[14]) && isVis(wl[16]))
        set(store.lForeArm, restData.get(store.lForeArm!), dirFn(wl[16], wl[14]));

      // Avatar RIGHT arm ← user's LEFT arm (MP: shoulder=11, elbow=13, wrist=15)
      if (isVis(ls) && isVis(wl[13]))
        set(store.rUpperArm, restData.get(store.rUpperArm!), dirFn(wl[13], ls));
      if (isVis(wl[13]) && isVis(wl[15]))
        set(store.rForeArm, restData.get(store.rForeArm!), dirFn(wl[15], wl[13]));
    }

    // ── Neck tilt from nose/shoulder midpoint ──────────────────────────
    const nose = wl[0];
    if (store.neck && isVis(nose) && isVis(ls) && isVis(rs)) {
      const shMidX = (ls.x + rs.x) / 2;
      const shMidY = (ls.y + rs.y) / 2;
      const shMidZ = (ls.z + rs.z) / 2;
      // ySign: worldLandmarks → nose.y > shMidY; poseLandmarks → nose.y < shMidY
      const neckHeight = Math.max(0.01, ySign * (nose.y - shMidY));
      const lateralTilt = Math.atan2(-(nose.x - shMidX), neckHeight) * 0.5;
      // Negate Z delta: smaller Z = closer to camera in poseLandmarks.
      // Tilting chin forward brings nose closer → nose.z drops → negate so positive tilt = forward.
      // Additional negation (*-0.4) corrects AccuRig head/neck bone roll: the local X-axis
      // on AccuRig neck bones points opposite to CC_Base, so pitch must be inverted.
      const forwardTilt = Math.atan2(-(nose.z - shMidZ), neckHeight) * -0.4;
      const rest = restData.get(store.neck)!;
      targets.set(
        store.neck,
        rest.localQuat.clone().multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(forwardTilt, 0, lateralTilt, "XYZ")
          )
        )
      );
    }

    // ── Head yaw from ear Z-difference ─────────────────────────────────
    const earL = wl[7], earR = wl[8];
    if (store.head && isVis(earL) && isVis(earR)) {
      const earDZ = earL.z - earR.z;
      const earDX = Math.abs(earR.x - earL.x);
      const headYaw = Math.atan2(earDZ, Math.max(0.01, earDX)) * -0.6;
      const rest = restData.get(store.head)!;
      targets.set(
        store.head,
        rest.localQuat.clone().multiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), headYaw)
        )
      );
    }

    // ── Legs — disabled, focusing on upper body tracking for now ────────
    // Re-enable by uncommenting this block when ready to add leg tracking.
    // if (wl.length >= 29) {
    //   const lHip = wl[23], rHip = wl[24];
    //   const lKnee = wl[25], rKnee = wl[26];
    //   const lAnkle = wl[27], rAnkle = wl[28];
    //   if (isVis(rHip) && isVis(rKnee))
    //     set(store.lThigh, restData.get(store.lThigh!), dirFn(rKnee, rHip));
    //   if (isVis(lHip) && isVis(lKnee))
    //     set(store.rThigh, restData.get(store.rThigh!), dirFn(lKnee, lHip));
    //   if (isVis(rKnee) && isVis(rAnkle))
    //     set(store.lCalf, restData.get(store.lCalf!), dirFn(rAnkle, rKnee));
    //   if (isVis(lKnee) && isVis(lAnkle))
    //     set(store.rCalf, restData.get(store.rCalf!), dirFn(lAnkle, lKnee));
    //   if (wl.length >= 33) {
    //     const lFootIdx = wl[31], rFootIdx = wl[32];
    //     if (isVis(rAnkle) && isVis(rFootIdx))
    //       set(store.lFoot, restData.get(store.lFoot!), dirFn(rFootIdx, rAnkle));
    //     if (isVis(lAnkle) && isVis(lFootIdx))
    //       set(store.rFoot, restData.get(store.rFoot!), dirFn(lFootIdx, lAnkle));
    //   }
    // }
  }

  // ── Wrist orientation from hand landmarks ─────────────────────────────
  // Direction wrist(0) → middle MCP(9) gives hand forward vector
  if (rhLms && store.lHand) {
    const rest = restData.get(store.lHand);
    if (rest && rhLms[0] && rhLms[9]) {
      const dir = handDir(rhLms[9], rhLms[0]);
      if (dir.lengthSq() > 1e-10)
        targets.set(store.lHand, computeAimTarget(store.lHand, rest, dir));
    }
  }
  if (lhLms && store.rHand) {
    const rest = restData.get(store.rHand);
    if (rest && lhLms[0] && lhLms[9]) {
      const dir = handDir(lhLms[9], lhLms[0]);
      if (dir.lengthSq() > 1e-10)
        targets.set(store.rHand, computeAimTarget(store.rHand, rest, dir));
    }
  }

  // ── Fingers — all 3 joints per digit ─────────────────────────────────
  // Max rotation clamped to 75° for proximal/intermediate to prevent wild
  // overextension from noisy landmarks.
  // Distal (j=2) is driven proportionally from the intermediate (j=1) at 70%
  // to eliminate the virtual rest-direction instability entirely.
  const FINGER_MAX_ANGLE = 75;
  const DISTAL_SCALE = 0.7;

  const applyFingers = (fingers: HandFingers, lms: Landmark2D[]) => {
    for (let f = 0; f < 5; f++) {
      const bones = fingers[f];
      const pairs = FINGER_PAIRS[f];

      for (let j = 0; j < 2; j++) {
        const bone = bones[j];
        if (!bone) continue;
        const rest = restData.get(bone);
        if (!rest) continue;
        const [pi, ci] = pairs[j];
        if (!lms[pi] || !lms[ci]) continue;
        const dir = handDir(lms[ci], lms[pi]);
        if (dir.lengthSq() < 1e-10) continue;
        targets.set(bone, computeAimTarget(bone, rest, dir, FINGER_MAX_ANGLE));
      }

      // Distal joint: proportional from intermediate rather than independent aim
      const distal = bones[2];
      const intermediate = bones[1];
      if (distal && intermediate) {
        const distalRest = restData.get(distal);
        const intermediateRest = restData.get(intermediate);
        const intermediateTarget = targets.get(intermediate);
        if (distalRest && intermediateRest && intermediateTarget) {
          // Delta rotation applied to the intermediate bone from its rest pose
          const delta = intermediateTarget
            .clone()
            .multiply(intermediateRest.localQuat.clone().invert());
          // Scale the rotation to DISTAL_SCALE (slerp from identity)
          const scaledDelta = new THREE.Quaternion().slerp(delta, DISTAL_SCALE);
          targets.set(distal, scaledDelta.multiply(distalRest.localQuat.clone()));
        }
      }
    }
  };

  if (rhLms) applyFingers(store.lFingers, rhLms);
  if (lhLms) applyFingers(store.rFingers, lhLms);

  return targets;
}

// ─── Component ─────────────────────────────────────────────────────────────

const ALPHA_BODY = 0.14;
const ALPHA_FINGER = 0.09;

export default function AvatarScene() {
  const mountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState("Initializing…");
  const [showSkeleton, setShowSkeleton] = useState(true);

  const holisticDataRef = useRef<HolisticResults | null>(null);
  const boneStoreRef = useRef<BoneStore | null>(null);
  const restDataRef = useRef<Map<THREE.Bone, BoneRestData>>(new Map());
  const smoothedRef = useRef<Map<THREE.Bone, THREE.Quaternion>>(new Map());

  useMediaPipeHolistic(
    videoRef,
    (results) => {
      holisticDataRef.current = results;
      const hasBody = (results.poseLandmarks?.length ?? results.poseWorldLandmarks?.length ?? 0) > 0;
      const hasHands = results.leftHandLandmarks || results.rightHandLandmarks;
      if (hasBody)
        setStatus(hasHands ? "Tracking body + hands" : "Tracking body");
      else
        setStatus("No pose detected");
    },
    (msg) => setStatus(msg)
  );

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    setStatus("Loading…");

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setStatus("WebGL not supported in this environment");
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000);
    mountEl.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 100);
    camera.position.set(0, 1.5, 2.5);
    camera.lookAt(0, 1, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(0.5, 2, 2);
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0x8899ff, 0.3);
    fill.position.set(-1, 0.5, -1);
    scene.add(fill);

    let animFrameId: number;

    new GLTFLoader().load(
      new URL("/hamzat.glb", window.location.origin).href,
      (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(0.1);
        scene.add(model);

        // Frame camera on upper body
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const torsoY = center.y + size.y * 0.15;
        camera.position.set(center.x, torsoY, size.y * 0.32 + 0.3);
        camera.lookAt(center.x, torsoY, center.z);

        // Discover bones, capture rest pose
        const store = buildBoneStore(model);
        model.updateMatrixWorld(true);
        const restData = captureRestData(store);

        // Initialize smoothed quats from rest
        const smoothed = new Map<THREE.Bone, THREE.Quaternion>();
        for (const [bone, rd] of restData) {
          smoothed.set(bone, rd.localQuat.clone());
        }

        boneStoreRef.current = store;
        restDataRef.current = restData;
        smoothedRef.current = smoothed;
        setStatus("Waiting for camera…");
      },
      undefined,
      (err) => {
        console.error("GLB load error", err);
        setStatus("Failed to load avatar");
      }
    );

    function renderLoop() {
      animFrameId = requestAnimationFrame(renderLoop);

      const store = boneStoreRef.current;
      const restData = restDataRef.current;
      const smoothed = smoothedRef.current;
      const data = holisticDataRef.current;

      if (store && data) {
        // Reset all tracked bones to rest pose for consistent target computation
        for (const [bone, rd] of restData) {
          bone.quaternion.copy(rd.localQuat);
        }
        (store.root.parent ?? store.root).updateMatrixWorld(true);

        // Compute targets from rest-pose world state
        const targets = computeTargets(data, store, restData);

        // Slerp smoothed quaternions toward targets, apply to bones
        for (const [bone, target] of targets) {
          const sm = smoothed.get(bone);
          if (!sm) continue;
          const isFingerBone = /thumb|index|middle|ring|pinky/i.test(bone.name);
          slerpBone(bone, sm, target, isFingerBone ? ALPHA_FINGER : ALPHA_BODY);
        }
        // Apply remaining smoothed quats (bones not in targets stay at their last smooth value)
        for (const [bone, sm] of smoothed) {
          if (!targets.has(bone)) bone.quaternion.copy(sm);
        }
      }

      renderer.render(scene, camera);
    }
    renderLoop();

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (mountEl.contains(renderer.domElement)) mountEl.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#000" }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />

      <div
        style={{
          position: "fixed", top: 12, left: 12,
          color: "#00ff88", fontFamily: "monospace", fontSize: 13,
          background: "rgba(0,0,0,0.55)", padding: "4px 10px", borderRadius: 4,
          pointerEvents: "none", zIndex: 10,
        }}
      >
        {status}
      </div>

      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          position: "fixed", bottom: 12, right: 12,
          width: 200, height: 150, objectFit: "cover",
          transform: "scaleX(-1)", borderRadius: 8,
          border: "2px solid rgba(0,255,136,0.4)", zIndex: 10,
        }}
      />

      <SkeletonOverlay resultsRef={holisticDataRef} visible={showSkeleton} />

      <button
        onClick={() => setShowSkeleton((v) => !v)}
        style={{
          position: "fixed", bottom: 12, right: 220,
          fontFamily: "monospace", fontSize: 12,
          color: showSkeleton ? "#00ff88" : "#888",
          background: "rgba(0,0,0,0.6)",
          border: `1px solid ${showSkeleton ? "rgba(0,255,136,0.5)" : "rgba(128,128,128,0.4)"}`,
          borderRadius: 4, padding: "4px 10px",
          cursor: "pointer", zIndex: 12,
          transition: "color 0.15s, border-color 0.15s",
        }}
      >
        {showSkeleton ? "skeleton on" : "skeleton off"}
      </button>
    </div>
  );
}
