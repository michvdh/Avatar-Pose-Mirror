import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  useMediaPipeHolistic,
  HolisticResults,
  Landmark3D,
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

interface BoneStore {
  root: THREE.Object3D;
  hips: THREE.Bone | null;
  spine: THREE.Bone | null;
  spine1: THREE.Bone | null;
  neck: THREE.Bone | null;
  head: THREE.Bone | null;
  lShoulder: THREE.Bone | null;
  rShoulder: THREE.Bone | null;
  lUpperArm: THREE.Bone | null;
  lForeArm: THREE.Bone | null;
  lHand: THREE.Bone | null;
  rUpperArm: THREE.Bone | null;
  rForeArm: THREE.Bone | null;
  rHand: THREE.Bone | null;
  lThigh: THREE.Bone | null;
  rThigh: THREE.Bone | null;
  lCalf: THREE.Bone | null;
  rCalf: THREE.Bone | null;
  lFoot: THREE.Bone | null;
  rFoot: THREE.Bone | null;
}

// ─── Bone discovery ────────────────────────────────────────────────────────

function buildBoneStore(root: THREE.Object3D): BoneStore {
  const fb = (sets: string[][]) => findBone(root, sets);

  const store: BoneStore = {
    root,
    hips:   fb([["pelvis"], ["hips"], ["hip"]]),
    // spine: "spine01" catches CC_Base; plain "spine" relies on DFS (parent
    // visited before children) to find Spine before Spine1/Spine2 on Mixamo.
    spine:  fb([["spine01"], ["spine"], ["torso"]]),
    spine1: fb([["spine02"], ["spine1"], ["spine2"], ["chest"], ["upperchest"]]),
    neck:   fb([["neck"], ["neck01"]]),
    head:   fb([["head"]]),
    // "leftshoulder"/"rightshoulder" catches Mixamo LeftShoulder/RightShoulder.
    lShoulder: fb([["lclavicle"], ["claviclel"], ["leftshoulder"], ["lshoulder"], ["leftclavicle"]]),
    rShoulder: fb([["rclavicle"], ["clavicler"], ["rightshoulder"], ["rshoulder"], ["rightclavicle"]]),
    // "leftarm"/"rightarm" catches Mixamo LeftArm/RightArm (not LeftForeArm since
    // "leftarm" is not a substring of "leftforearm").
    lUpperArm: fb([["lupperarm"], ["upperarml"], ["leftupperarm"], ["leftarm"]]),
    lForeArm:  fb([["lforearm"],  ["lowerarml"], ["leftforearm"]]),
    lHand:     fb([["lhand"],     ["handl"],      ["lefthand"]]),
    rUpperArm: fb([["rupperarm"], ["upperarmr"], ["rightupperarm"], ["rightarm"]]),
    rForeArm:  fb([["rforearm"],  ["lowerarmr"], ["rightforearm"]]),
    rHand:     fb([["rhand"],     ["handr"],      ["righthand"]]),
    // "leftupleg"/"rightupleg" catches Mixamo LeftUpLeg/RightUpLeg.
    // "leftleg"/"rightleg" catches Mixamo LeftLeg/RightLeg (knee-to-ankle).
    lThigh: fb([["lthigh"], ["thighl"], ["leftthigh"], ["lupleg"], ["leftupleg"]]),
    rThigh: fb([["rthigh"], ["thighr"], ["rightthigh"], ["rupleg"], ["rightupleg"]]),
    lCalf:  fb([["lcalf"],  ["calfl"],  ["leftcalf"],  ["lleg"],  ["leftleg"]]),
    rCalf:  fb([["rcalf"],  ["calfr"],  ["rightcalf"], ["rleg"],  ["rightleg"]]),
    lFoot:  fb([["lfoot"],  ["footl"],  ["leftfoot"]]),
    rFoot:  fb([["rfoot"],  ["footr"],  ["rightfoot"]]),
  };

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
  euler(store.lHand);
  chain(store.rUpperArm, store.rForeArm);
  chain(store.rForeArm, store.rHand);
  euler(store.rHand);

  chain(store.lThigh, store.lCalf);
  chain(store.rThigh, store.rCalf);
  chain(store.lCalf, store.lFoot);
  chain(store.rCalf, store.rFoot);

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

  return map;
}

// ─── Landmark helpers ──────────────────────────────────────────────────────

const isVis = (lm: Landmark3D) => (lm.visibility ?? 1) >= 0.3;

// ─── Target computation ────────────────────────────────────────────────────

function computeTargets(
  data: HolisticResults,
  store: BoneStore,
  restData: Map<THREE.Bone, BoneRestData>,
  torsoAngles: { pitch: number; lean: number; yaw: number },
  restSpanRef: { current: number | null }
): Map<THREE.Bone, THREE.Quaternion> {
  const targets = new Map<THREE.Bone, THREE.Quaternion>();

  const imgLm = data.poseLandmarks;
  const wrldLm = (data.poseWorldLandmarks && data.poseWorldLandmarks.length > 0) 
    ? data.poseWorldLandmarks 
    : data.poseLandmarks;

  if (!imgLm || imgLm.length < 25) return targets;

  const getAnchorDir = (idxWrist: number, idxShoulder: number) => {
    const wW = wrldLm[idxWrist], wS = wrldLm[idxShoulder];
    const dx = -(wW.x - wS.x); 
    const dy = -(wW.y - wS.y);
    const dz = -(wW.z - wS.z);
    const dir = new THREE.Vector3(dx, dy, dz);
    if (dir.lengthSq() < 0.0001) return new THREE.Vector3(0, -1, 0); 
    return dir.normalize();
  };

  // ─── Human joint limits ───────────────────────────────────────────────────
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const deg = THREE.MathUtils.degToRad;

  // --- 1. TORSO MATH ---
  // MediaPipe world landmarks: X right, Y DOWN, Z toward camera.
  // So a standing person has head at negative Y, feet at positive Y.
  //
  // PITCH  (forward/back bend): spine vector (hip_mid → shoulder_mid) vs world up (0,-1,0).
  //   When upright the spine vector is (0,-1,0). Bowing forward rotates it toward camera (+Z).
  //   Limit: +45° forward, -20° backward.
  //
  // LATERAL LEAN (side bend): shoulder height difference (ls.y - rs.y) in MediaPipe Y-down space.
  //   When you lean RIGHT (avatar left, mirrored), your right shoulder drops → rs.y increases,
  //   so ls.y - rs.y becomes negative. Deadband ±2cm. Limit: ±30°.
  //
  // YAW (axial twist): shoulder X-span narrows when twisting. Calibrate rest span on
  //   first frame to avoid phantom twist from camera distance variation. Limit: ±40°.
  //   Large deadband (5°) so standing still never fires.
  //
  // All three angles are smoothed with a tight EMA (α=0.08) before use,
  // independent of the per-bone slerp smoothing in the render loop.

  let invTorsoQuat = new THREE.Quaternion();
  let fullTorsoQuat = new THREE.Quaternion();

  const lsVis = (wrldLm[11]?.visibility ?? 1) >= 0.5;
  const rsVis = (wrldLm[12]?.visibility ?? 1) >= 0.5;
  const lhVis = (wrldLm[23]?.visibility ?? 1) >= 0.4;
  const rhVis = (wrldLm[24]?.visibility ?? 1) >= 0.4;

  const TORSO_ALPHA = 0.08; // tight smoothing for torso — reduces jitter

  if (store.spine && lsVis && rsVis) {
    const ls = wrldLm[11], rs = wrldLm[12];

    // ── PITCH ──────────────────────────────────────────────────────────────
    // Spine direction in Y-down space: from hip midpoint to shoulder midpoint.
    // Upright = (0, -1, 0). Bowing forward tilts toward +Z.
    let rawPitch = 0;
    if (lhVis && rhVis) {
      const hipMid = new THREE.Vector3(
        (wrldLm[23].x + wrldLm[24].x) / 2,
        (wrldLm[23].y + wrldLm[24].y) / 2,
        (wrldLm[23].z + wrldLm[24].z) / 2,
      );
      const shoulderMid = new THREE.Vector3(
        (ls.x + rs.x) / 2,
        (ls.y + rs.y) / 2,
        (ls.z + rs.z) / 2,
      );
      // Spine vector points FROM hips TO shoulders (upward = negative Y in MP space)
      const spineVec = new THREE.Vector3().subVectors(shoulderMid, hipMid).normalize();
      // World up in MediaPipe = (0, -1, 0). Angle from that is the total tilt.
      // We only want the forward/back component: use spineVec.z (depth).
      // Positive spineVec.z = shoulders forward = bow forward.
      rawPitch = clamp(Math.asin(clamp(spineVec.z, -1, 1)), -deg(20), deg(45));
    }
    torsoAngles.pitch += TORSO_ALPHA * (rawPitch - torsoAngles.pitch);

    // ── LATERAL LEAN ───────────────────────────────────────────────────────
    // In Y-down space, leaning left raises left shoulder (ls.y more negative).
    // ls.y - rs.y: negative when leaning left (avatar leans its left = our right).
    // Deadband ±2 cm to absorb head-turn leakage.
    const LEAN_DEAD = 0.02;
    const rawDY = ls.y - rs.y;
    const rawLean = Math.abs(rawDY) < LEAN_DEAD ? 0
      : clamp(-rawDY * 3.0, -deg(30), deg(30)); // negate: Y-down → right-hand rule
    torsoAngles.lean += TORSO_ALPHA * (rawLean - torsoAngles.lean);

    // ── YAW ────────────────────────────────────────────────────────────────
    // Calibrate rest span on the first valid frame so camera distance doesn't matter.
    const spanX = Math.abs(ls.x - rs.x);
    if (restSpanRef.current === null) restSpanRef.current = spanX;
    const restSpan = restSpanRef.current;

    const spanRatio  = Math.min(spanX / restSpan, 1.0);
    const rawYawMag  = Math.acos(spanRatio); // 0 when at rest, grows as you twist
    // Sign from Z: in MP space, if left shoulder is closer (ls.z > rs.z) → twisting right
    const yawSign    = (ls.z - rs.z) > 0 ? -1 : 1; // mirrored camera
    // Large deadband (5°) — only fire yaw for deliberate twists
    const rawYaw     = rawYawMag < deg(5) ? 0
      : clamp(yawSign * rawYawMag, -deg(40), deg(40));
    torsoAngles.yaw += TORSO_ALPHA * (rawYaw - torsoAngles.yaw);

    // ── AXIS TEST ────────────────────────────────────────────────────────────
    // Drive a sine wave lean on each axis in turn (5s per axis) so we can see
    // visually which one produces a sideways bend on Astra's rig.
    // X=0-5s, Y=5-10s, Z=10-15s, then repeats. Check browser console for label.
    const t = (Date.now() / 1000) % 15;
    const wave = Math.sin(Date.now() / 800) * deg(25);
    let testAxis: THREE.Vector3;
    if (t < 5)       { testAxis = new THREE.Vector3(1, 0, 0); if (Math.floor(t) !== Math.floor(t - 0.016)) console.log('[AXIS TEST] LOCAL X'); }
    else if (t < 10) { testAxis = new THREE.Vector3(0, 1, 0); if (Math.floor(t) !== Math.floor(t - 0.016)) console.log('[AXIS TEST] LOCAL Y'); }
    else             { testAxis = new THREE.Vector3(0, 0, 1); if (Math.floor(t) !== Math.floor(t - 0.016)) console.log('[AXIS TEST] LOCAL Z'); }

    const testQ = new THREE.Quaternion().setFromAxisAngle(testAxis, wave);
    // Try both pre and post multiply to cover all cases
    const preQ  = testQ.clone().multiply(restData.get(store.spine)!.localQuat);
    const postQ = restData.get(store.spine)!.localQuat.clone().multiply(testQ);
    // Use pre for spine, post for spine1 — compare which looks right
    targets.set(store.spine,  preQ);
    if (store.spine1) targets.set(store.spine1, postQ);

    fullTorsoQuat = new THREE.Quaternion();
    invTorsoQuat  = new THREE.Quaternion();
  } else if (store.spine) {
    targets.set(store.spine, restData.get(store.spine)!.localQuat.clone());
    if (store.spine1) targets.set(store.spine1, restData.get(store.spine1)!.localQuat.clone());
  }

  // --- 2. UNIFIED ARM CHAIN ---
  const applyArmChain = (
    sIdx: number, eIdx: number, wIdx: number,
    upper: THREE.Bone | null, fore: THREE.Bone | null,
    isL: boolean
  ) => {
    if (!isVis(imgLm[sIdx]) || !isVis(imgLm[eIdx]) || !upper) return;

    // A. Upper arm: shoulder → elbow direction in body space
    const rU_world = getAnchorDir(eIdx, sIdx);
    const rU_body  = rU_world.clone().applyQuaternion(invTorsoQuat);
    targets.set(upper, computeAimTarget(upper, restData.get(upper)!, rU_body));

    if (!fore || !isVis(imgLm[wIdx])) return;

    // B. Forearm: elbow → wrist direction, de-rotated by the upper arm swing
    const rF_world = getAnchorDir(wIdx, eIdx);
    const rF_body  = rF_world.clone().applyQuaternion(invTorsoQuat);

    const upperSwing = new THREE.Quaternion().setFromUnitVectors(
      restData.get(upper)!.worldDir, rU_body
    );
    const localFore = rF_body.clone().applyQuaternion(upperSwing.clone().invert());

    if (isL) {
      // Left arm: pass localFore directly — no axis correction needed
      targets.set(fore, computeAimTarget(fore, restData.get(fore)!, localFore));
    } else {
      // Right arm: Mixamo right forearm bone has its axes mirrored vs the left.
      // Negate all three components so the hinge folds outward (away from chest)
      // instead of inward. This is stable across all arm positions.
      const mirroredFore = new THREE.Vector3(-localFore.x, -localFore.y, -localFore.z);
      targets.set(fore, computeAimTarget(fore, restData.get(fore)!, mirroredFore));
    }
  };

  // EXECUTE MAPPING
  // User's physical RIGHT arm (12,14,16) drives Avatar's LEFT arm
  applyArmChain(12, 14, 16, store.lUpperArm, store.lForeArm, true);
  
  // User's physical LEFT arm (11,13,15) drives Avatar's RIGHT arm
  applyArmChain(11, 13, 15, store.rUpperArm, store.rForeArm, false);

  // --- 3. HEAD & NECK MATH ---
  // Head angles are computed in world space, then multiplied by invTorsoQuat
  // to express them relative to the torso. This means: if the torso yaws 20°
  // and the head stays still in the world, the avatar's head counter-steers
  // 20° back — keeping it upright. Only genuine head movement adds rotation.
  if (isVis(imgLm[0]) && isVis(imgLm[7]) && isVis(imgLm[8])) {
    const noseW = wrldLm[0], earLW = wrldLm[7], earRW = wrldLm[8];

    // Pitch: nose above/below ear midpoint
    const pitch = clamp(
      Math.atan2(noseW.y - (earLW.y + earRW.y) / 2, 0.2),
      -deg(30), deg(40)
    );

    // Yaw: ear Z depth difference — when head turns one ear comes forward.
    // Deadband ±2° so torso twist noise doesn't leak into head yaw.
    const earDZ  = earLW.z - earRW.z;
    const earDX  = Math.max(0.01, Math.abs(earRW.x - earLW.x));
    const rawYaw = -Math.atan2(earDZ, earDX);
    const yaw    = clamp(
      Math.abs(rawYaw) < deg(2) ? 0 : rawYaw,
      -deg(70), deg(70)
    );

    // Roll: ear height difference
    const roll = clamp(
      Math.atan2(earRW.y - earLW.y, earDX),
      -deg(30), deg(30)
    );

    // Build world-space head quaternion
    const faceWorldQuat = new THREE.Quaternion()
      .multiplyQuaternions(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw   * 0.85),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch * 1.1)
      )
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -roll * 0.8));

    // Convert to torso-relative space — this is the counter-steer
    const masterHeadQuat = invTorsoQuat.clone().multiply(faceWorldQuat);

    // Distribute: neck takes 40%, head takes the remainder
    const neckQuat = new THREE.Quaternion().slerp(masterHeadQuat, 0.4);
    const headQuat = masterHeadQuat.clone().multiply(neckQuat.clone().invert());

    if (store.neck) targets.set(store.neck, restData.get(store.neck)!.localQuat.clone().multiply(neckQuat));
    if (store.head) targets.set(store.head, restData.get(store.head)!.localQuat.clone().multiply(headQuat));
  }

  return targets;
}

// ─── Component ─────────────────────────────────────────────────────────────

const ALPHA_BODY = 0.14;

export default function AvatarScene() {
  const mountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState("Initializing…");
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [bgColor, setBgColor] = useState<"#000000" | "#ffffff">("#000000");
  const bgColorRef = useRef<"#000000" | "#ffffff">("#000000");
  const sceneRef = useRef<THREE.Scene | null>(null);

  useEffect(() => {
    bgColorRef.current = bgColor;
    if (sceneRef.current) sceneRef.current.background = new THREE.Color(bgColor);
  }, [bgColor]);

  const holisticDataRef = useRef<HolisticResults | null>(null);
  const boneStoreRef = useRef<BoneStore | null>(null);
  const restDataRef = useRef<Map<THREE.Bone, BoneRestData>>(new Map());
  const smoothedRef = useRef<Map<THREE.Bone, THREE.Quaternion>>(new Map());
  const fingerRestMapRef = useRef<Map<THREE.Bone, THREE.Quaternion>>(new Map());
  // Per-frame smoothed torso angles — prevents jitter from raw landmark noise
  const torsoAnglesRef = useRef({ pitch: 0, lean: 0, yaw: 0 });
  // Calibrated shoulder span (set on first valid frame, used for yaw detection)
  const restShoulderSpanRef = useRef<number | null>(null);

  useMediaPipeHolistic(
    videoRef,
    (results) => {
      holisticDataRef.current = results;
      const hasBody = (results.poseLandmarks?.length ?? results.poseWorldLandmarks?.length ?? 0) > 0;
      if (hasBody)
        setStatus("Tracking body (Hands parked)");
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
    scene.background = new THREE.Color(bgColorRef.current);
    sceneRef.current = scene;
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
      new URL("/Astra.glb", window.location.origin).href,
      (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(0.1);
        scene.add(model);

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const fovRad = THREE.MathUtils.degToRad(camera.fov);
        const zForHeight = (size.y / 2) / Math.tan(fovRad / 2);
        const zForWidth  = (size.x / 2) / (Math.tan(fovRad / 2) * camera.aspect);
        const zDist = Math.max(zForHeight, zForWidth) * 1.50; 
        camera.position.set(center.x, center.y, center.z + zDist);
        camera.lookAt(center.x, center.y, center.z);

        const store = buildBoneStore(model);
        model.updateMatrixWorld(true);
        const restData = captureRestData(store);

        // Collect every finger bone (children of lHand / rHand) and snapshot
        // their rest quaternions so we can pin them to rest every frame.
        const fingerRestMap = new Map<THREE.Bone, THREE.Quaternion>();
        const collectFingers = (handBone: THREE.Bone | null) => {
          if (!handBone) return;
          handBone.traverse((child) => {
            if (child !== handBone && child instanceof THREE.Bone) {
              fingerRestMap.set(child, child.quaternion.clone());
            }
          });
        };
        collectFingers(store.lHand);
        collectFingers(store.rHand);
        fingerRestMapRef.current = fingerRestMap;

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
        for (const [bone, rd] of restData) {
          bone.quaternion.copy(rd.localQuat);
        }
        (store.root.parent ?? store.root).updateMatrixWorld(true);

        const targets = computeTargets(
          data, store, restData,
          torsoAnglesRef.current,
          restShoulderSpanRef
        );

        for (const [bone, target] of targets) {
          const sm = smoothed.get(bone);
          if (!sm) continue;

          // --- ADAPTIVE SMOOTHING ---
          // Calculate the angular distance between current smoothed pose and target
          const angleDist = sm.angleTo(target);
          
          // If the distance is large, boost the ALPHA to 0.4 (High speed)
          // If the distance is small, use 0.1 (Smooth slow movement)
          const dynamicAlpha = THREE.MathUtils.clamp(angleDist * 2, 0.1, 0.4);

          slerpBone(bone, sm, target, dynamicAlpha);
        }
        for (const [bone, sm] of smoothed) {
          if (!targets.has(bone)) bone.quaternion.copy(sm);
        }

        // Pin all finger bones to their rest pose — no finger tracking active.
        for (const [bone, restQ] of fingerRestMapRef.current) {
          bone.quaternion.copy(restQ);
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
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: bgColor }}>
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

      <button
        onClick={() => setBgColor((c) => (c === "#000000" ? "#ffffff" : "#000000"))}
        style={{
          position: "fixed", bottom: 12, right: 360,
          fontFamily: "monospace", fontSize: 12,
          color: bgColor === "#ffffff" ? "#333" : "#aaa",
          background: bgColor === "#ffffff" ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.6)",
          border: `1px solid ${bgColor === "#ffffff" ? "rgba(0,0,0,0.25)" : "rgba(180,180,180,0.3)"}`,
          borderRadius: 4, padding: "4px 10px",
          cursor: "pointer", zIndex: 12,
          transition: "color 0.15s, background 0.15s, border-color 0.15s",
        }}
      >
        {bgColor === "#ffffff" ? "bg: white" : "bg: black"}
      </button>
    </div>
  );
}