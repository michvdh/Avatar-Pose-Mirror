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
  lShoulder: THREE.Bone | null;
  rShoulder: THREE.Bone | null;
  lUpperArm: THREE.Bone | null;
  lForeArm: THREE.Bone | null;
  lHand: THREE.Bone | null;
  lFingers: HandFingers;
  rUpperArm: THREE.Bone | null;
  rForeArm: THREE.Bone | null;
  rHand: THREE.Bone | null;
  rFingers: HandFingers;
  lThigh: THREE.Bone | null;
  rThigh: THREE.Bone | null;
  lCalf: THREE.Bone | null;
  rCalf: THREE.Bone | null;
  lFoot: THREE.Bone | null;
  rFoot: THREE.Bone | null;
}

// ─── Bone discovery ────────────────────────────────────────────────────────

function finger(root: THREE.Object3D, side: string, name: string): FingerBones {
  const s = side[0]; 
  const f = (n: number) =>
    findBone(root, [
      [`${s}${name}${n}`],          
      [`${name}0${n}${s}`],         
      [`${side}hand${name}${n}`],   
      [`${name}${n}`, s, "hand"],   
    ]);
  return [f(1), f(2), f(3)];
}

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
    lFingers: [
      finger(root, "left", "thumb"),
      finger(root, "left", "index"),
      finger(root, "left", "middle"),
      finger(root, "left", "ring"),
      finger(root, "left", "pinky"),
    ],
    rUpperArm: fb([["rupperarm"], ["upperarmr"], ["rightupperarm"], ["rightarm"]]),
    rForeArm:  fb([["rforearm"],  ["lowerarmr"], ["rightforearm"]]),
    rHand:     fb([["rhand"],     ["handr"],      ["righthand"]]),
    rFingers: [
      finger(root, "right", "thumb"),
      finger(root, "right", "index"),
      finger(root, "right", "middle"),
      finger(root, "right", "ring"),
      finger(root, "right", "pinky"),
    ],
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
  chain(store.lHand, store.lFingers[2][0] ?? store.lFingers[1][0]);
  chain(store.rUpperArm, store.rForeArm);
  chain(store.rForeArm, store.rHand);
  chain(store.rHand, store.rFingers[2][0] ?? store.rFingers[1][0]);

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

  for (const hand of [store.lFingers, store.rFingers]) {
    for (const fg of hand) {
      euler(fg[0]); euler(fg[1]); euler(fg[2]);
    }
  }
  return map;
}

// ─── Landmark helpers ──────────────────────────────────────────────────────

const isVis = (lm: Landmark3D) => (lm.visibility ?? 1) >= 0.3;

function handDir(child: Landmark2D, parent: Landmark2D): THREE.Vector3 {
  return new THREE.Vector3(
    -(child.x - parent.x),
    -(child.y - parent.y),
    -((child.z ?? 0) - (parent.z ?? 0))
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

  const imgLm = data.poseLandmarks;
  const wrldLm = (data.poseWorldLandmarks && data.poseWorldLandmarks.length > 0) 
    ? data.poseWorldLandmarks 
    : data.poseLandmarks;

  if (!imgLm || imgLm.length < 25) return targets;

  const ls = imgLm[11], rs = imgLm[12]; 

  const getAnchorDir = (idxWrist: number, idxShoulder: number) => {
    // FIX: Use ONLY the true 3D world landmarks, ignoring the warped 2D image landmarks
    const wW = wrldLm[idxWrist], wS = wrldLm[idxShoulder];
    
    // MIRROR MATH: Invert all three axes. This maps MediaPipe's coordinate system 
    // cleanly to Three.js while perfectly mirroring your physical movements.
    const dx = -(wW.x - wS.x); 
    const dy = -(wW.y - wS.y);
    const dz = -(wW.z - wS.z);
    
    const dir = new THREE.Vector3(dx, dy, dz);
    
    // Safety fallback: prevents the app from crashing if the vector drops to absolute zero
    if (dir.lengthSq() < 0.0001) {
      return new THREE.Vector3(0, -1, 0); 
    }
    
    return dir.normalize();
  };

  // --- 1. TORSO MATH ---
  let invTorsoQuat = new THREE.Quaternion();
  if (store.spine && isVis(ls) && isVis(imgLm[12])) {
    const lsW = wrldLm[11], rsW = wrldLm[12];
    const shoulderDY = lsW.y - rsW.y; 
    const shoulderDistXZ = Math.hypot(lsW.x - rsW.x, lsW.z - rsW.z);
    const lateralLean = Math.atan2(shoulderDY, Math.max(0.01, shoulderDistXZ)) * 1.5; 
    
    // FIX 3: Lock Torso Yaw. 
    // Z-depth differences from webcams cause the avatar to drift/turn left or right 
    // even when you are standing still. Setting yaw to 0 keeps the body squared.
    const yaw = 0; 
    
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const latQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), lateralLean);
    
    const fullTorsoQuat = new THREE.Quaternion().multiplyQuaternions(yawQ, latQ);
    invTorsoQuat = fullTorsoQuat.clone().invert();

    if (store.spine1) {
      const halfTorso = new THREE.Quaternion().slerp(fullTorsoQuat, 0.5);
      targets.set(store.spine, restData.get(store.spine)!.localQuat.clone().multiply(halfTorso));
      targets.set(store.spine1, restData.get(store.spine1)!.localQuat.clone().multiply(halfTorso));
    } else {
      targets.set(store.spine, restData.get(store.spine)!.localQuat.clone().multiply(fullTorsoQuat));
    }
  }

// --- 2. ARM MATH (MIRRORED & STABILIZED) ---
  const armVis = (imgLm[13]?.visibility ?? 0) >= 0.5 && (imgLm[14]?.visibility ?? 0) >= 0.5;
  if (armVis) {

    // MIRROR MAPPING 1: User's RIGHT arm (12, 14, 16) drives Avatar's LEFT arm
    if (isVis(imgLm[12]) && isVis(imgLm[14])) {
      const rawUpper = getAnchorDir(14, 12);
      const lUpperRest = restData.get(store.lUpperArm!)!;
      set(store.lUpperArm, lUpperRest, rawUpper);

      if (isVis(imgLm[16])) {
        const rawFore = getAnchorDir(16, 14);
        if (rawUpper.angleTo(rawFore) < THREE.MathUtils.degToRad(15)) rawFore.copy(rawUpper);
        
        const lForeRest = restData.get(store.lForeArm!)!;
        const upperSwing = new THREE.Quaternion().setFromUnitVectors(lUpperRest.worldDir, rawUpper);
        
        // 1. MUST keep .invert() so the elbow math stays anchored to the shoulder
        const localFore = rawFore.clone().applyQuaternion(upperSwing.clone().invert());
        
        // REMOVED THE FIX: The left arm is the default Mixamo bone. 
        // It does not need its axes flipped.
        
        set(store.lForeArm, lForeRest, localFore);
      }
    }

    // MIRROR MAPPING 2: User's LEFT arm (11, 13, 15) drives Avatar's RIGHT arm
    if (isVis(imgLm[11]) && isVis(imgLm[13])) {
      const rawUpper = getAnchorDir(13, 11);
      const rUpperRest = restData.get(store.rUpperArm!)!;
      set(store.rUpperArm, rUpperRest, rawUpper);

      if (isVis(imgLm[15])) {
        const rawFore = getAnchorDir(15, 13);
        if (rawUpper.angleTo(rawFore) < THREE.MathUtils.degToRad(15)) rawFore.copy(rawUpper);
        
        const rForeRest = restData.get(store.rForeArm!)!;
        const upperSwing = new THREE.Quaternion().setFromUnitVectors(rUpperRest.worldDir, rawUpper);
        
        // 1. MUST keep .invert() so the elbow math stays anchored to the shoulder
        const localFore = rawFore.clone().applyQuaternion(upperSwing.clone().invert());
        
        // 2. THE FINAL FIX: Flip X, Y, and Z to completely cancel out the Mixamo 
        // right-arm mirror effect, forcing the hinge to fold naturally inward.
        localFore.x = -localFore.x;
        localFore.y = -localFore.y;
        localFore.z = -localFore.z;
        
        set(store.rForeArm, rForeRest, localFore);
      }
    }
  }

  // --- 3. HAND & FINGER MATH ---
  const applyHandTracking = (
    handLm: Landmark3D[],
    handBone: THREE.Bone | null,
    isAvatarLeft: boolean
  ) => {
    if (!handLm || !handBone) return;

    // Determine physical arm mapping to get the forearm direction
    const elbowIdx = isAvatarLeft ? 14 : 13;
    const wristIdx = isAvatarLeft ? 16 : 15;
    const forearmDir = getAnchorDir(wristIdx, elbowIdx);

    // Get absolute wrist pointing direction
    const dx = -(handLm[9].x - handLm[0].x);
    const dy = -(handLm[9].y - handLm[0].y);
    const dz = -(handLm[9].z - handLm[0].z);
    const wristDir = new THREE.Vector3(dx, dy, dz);
    
    if (wristDir.lengthSq() < 0.0001) return;
    wristDir.normalize();

    // FIX 1: BEND (Relative to Forearm)
    // This prevents the hand from folding backward. We calculate the difference
    // between the forearm and the hand, and apply ONLY that difference to the rest pose.
    const bendQuat = new THREE.Quaternion().setFromUnitVectors(forearmDir, wristDir);
    const handRest = restData.get(handBone)!;
    const bentQuat = handRest.localQuat.clone().multiply(bendQuat);

    // FIX 2: TWIST (Pronation / Supination)
    // We calculate the Z-depth difference between the Pinky and Index knuckles.
    // If the palm turns, one knuckle gets closer to the camera and the other moves away.
    const dZ = handLm[17].z - handLm[5].z;
    const dX = handLm[17].x - handLm[5].x;
    const dY = handLm[17].y - handLm[5].y;
    
    const distXY = Math.hypot(dX, dY);
    let twistAngle = Math.atan2(dZ, Math.max(0.01, distXY)) * 1.5; // 1.5 amplifies the twist visibility
    
    // Mirror the twist direction for the right arm
    if (!isAvatarLeft) twistAngle = -twistAngle;

    // Apply the twist around the local Y axis (Mixamo's bone length axis)
    const twistQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), twistAngle);
    const finalQuat = bentQuat.multiply(twistQuat);

    targets.set(handBone, finalQuat);
  };

  // APPLY MIRRORED HANDS
  // User's physical RIGHT hand drives Avatar's LEFT hand
  if (data.rightHandLandmarks) {
    applyHandTracking(data.rightHandLandmarks, store.lHand, true);
  }
  // User's physical LEFT hand drives Avatar's RIGHT hand
  if (data.leftHandLandmarks) {
    applyHandTracking(data.leftHandLandmarks, store.rHand, false);
  }

 // ─── HEAD & NECK MATH (FIXED: COUNTER-STEER) ─────────────────────────
    if (isVis(imgLm[0]) && isVis(imgLm[7]) && isVis(imgLm[8])) {
      const noseW = wrldLm[0];
      const earLW = wrldLm[7];
      const earRW = wrldLm[8];

      // 1. PITCH (Up/Down) 
      const earMidY = (earLW.y + earRW.y) / 2;
      const pitch = Math.atan2(noseW.y - earMidY, 0.2);

      // 2. YAW (Turn)
      const earDZ = earLW.z - earRW.z;
      const earDX = Math.abs(earRW.x - earLW.x);
      const yaw = -Math.atan2(earDZ, Math.max(0.01, earDX));

      // 3. ROLL (Tilt)
      const earDY = earRW.y - earLW.y;
      const roll = Math.atan2(earDY, Math.max(0.01, earDX));

      // Build raw face quaternions
      const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch * 1.2);
      const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw * 0.8);
      const rollQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -roll * 0.8);

      // 4. THE COUNTER-STEER FIX:
      // First, combine the raw face angles into an absolute world rotation
      const faceWorldQuat = new THREE.Quaternion().multiplyQuaternions(yawQ, pitchQ).multiply(rollQ);
      
      // Second, multiply by `invTorsoQuat` to mathematically subtract the spine's tilt!
      const masterHeadQuat = invTorsoQuat.clone().multiply(faceWorldQuat);
      
      // 5. SMOOTH DISTRIBUTION:
      // The neck takes 40% of the movement, smoothing out the counter-steer.
      const identityQ = new THREE.Quaternion();
      const neckQuat = identityQ.clone().slerp(masterHeadQuat, 0.4);
      
      // The head takes whatever rotation is left over from the neck.
      const headQuat = masterHeadQuat.clone().multiply(neckQuat.clone().invert());

      if (store.neck) targets.set(store.neck, restData.get(store.neck)!.localQuat.clone().multiply(neckQuat));
      if (store.head) targets.set(store.head, restData.get(store.head)!.localQuat.clone().multiply(headQuat));
    }

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

        const targets = computeTargets(data, store, restData);

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