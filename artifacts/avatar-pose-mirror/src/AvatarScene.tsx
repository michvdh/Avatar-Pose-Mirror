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
}

// ─── Bone discovery ────────────────────────────────────────────────────────

// Side-specific keyword: use the first letter immediately before a keyword
// so "lupperarm" matches CC_Base_L_Upperarm→"ccbaselupperarm" but NOT R_Upperarm→"ccbaserupperarm"
function finger(root: THREE.Object3D, side: string, name: string): FingerBones {
  const s = side[0]; // "l" or "r"
  const f = (n: number) =>
    findBone(root, [
      [`${s}${name}${n}`],          // CC_Base: lthumb1, rindex2
      [`${side}hand${name}${n}`],   // Mixamo: lefthandthumb1
      [`${name}${n}`, s, "hand"],   // broad fallback
    ]);
  return [f(1), f(2), f(3)];
}

function buildBoneStore(root: THREE.Object3D): BoneStore {
  const fb = (sets: string[][]) => findBone(root, sets);

  const store: BoneStore = {
    root,
    hips: fb([["hips"], ["hip"], ["pelvis"]]),
    // Spine: use specific joint names to avoid ambiguity
    spine: fb([["spine01"], ["spine1"], ["spine"], ["torso"]]),
    spine1: fb([["spine02"], ["spine2"], ["chest"], ["upperchest"]]),
    neck: fb([["neck"]]),
    head: fb([["head"]]),
    // Avatar LEFT arm — "lupperarm" only matches l_upperarm not r_upperarm
    lUpperArm: fb([["lupperarm"], ["leftarm"], ["leftupperarm"]]),
    lForeArm:  fb([["lforearm"],  ["leftforearm"]]),
    lHand:     fb([["lhand"],     ["lefthand"]]),
    lFingers: [
      finger(root, "left", "thumb"),
      finger(root, "left", "index"),
      finger(root, "left", "middle"),
      finger(root, "left", "ring"),
      finger(root, "left", "pinky"),
    ],
    // Avatar RIGHT arm
    rUpperArm: fb([["rupperarm"], ["rightarm"], ["rightupperarm"]]),
    rForeArm:  fb([["rforearm"],  ["rightforearm"]]),
    rHand:     fb([["rhand"],     ["righthand"]]),
    rFingers: [
      finger(root, "right", "thumb"),
      finger(root, "right", "index"),
      finger(root, "right", "middle"),
      finger(root, "right", "ring"),
      finger(root, "right", "pinky"),
    ],
  };

  // Debug log
  const report = (label: string, b: THREE.Bone | null) =>
    console.log(`[bones] ${label}: ${b?.name ?? "NOT FOUND"}`);
  report("hips", store.hips); report("spine", store.spine);
  report("lUpperArm", store.lUpperArm); report("lForeArm", store.lForeArm); report("lHand", store.lHand);
  report("rUpperArm", store.rUpperArm); report("rForeArm", store.rForeArm); report("rHand", store.rHand);

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

  chain(store.lUpperArm, store.lForeArm);
  chain(store.lForeArm, store.lHand);
  chain(store.rUpperArm, store.rForeArm);
  chain(store.rForeArm, store.rHand);

  for (const hand of [store.lFingers, store.rFingers]) {
    for (const fg of hand) {
      chain(fg[0], fg[1]);
      chain(fg[1], fg[2]);
    }
  }
  return map;
}

// ─── Landmark helpers ──────────────────────────────────────────────────────

const isVis = (lm: Landmark3D) => (lm.visibility ?? 1) >= 0.3;

// poseWorldLandmarks: Y is already up, negate X for mirror
function worldDir(child: Landmark3D, parent: Landmark3D): THREE.Vector3 {
  return new THREE.Vector3(
    -(child.x - parent.x),
    (child.y - parent.y),
    (child.z - parent.z)
  ).normalize();
}

// 2D hand landmarks: negate both X (mirror) and Y (image-down → world-up)
function handDir(child: Landmark2D, parent: Landmark2D): THREE.Vector3 {
  return new THREE.Vector3(
    -(child.x - parent.x),
    -(child.y - parent.y),
    0
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

  const wl = data.poseWorldLandmarks;
  // Holistic labels hands from subject's perspective: right = user's right, left = user's left
  // Mirror: user RIGHT → avatar LeftHand (visual right); user LEFT → avatar RightHand (visual left)
  const rhLms = data.rightHandLandmarks; // user RIGHT → avatar lFingers
  const lhLms = data.leftHandLandmarks;  // user LEFT  → avatar rFingers

  if (wl && wl.length >= 25) {
    // ── Hips yaw (torso twist from shoulder Z-spread) ──────────────────
    if (store.hips) {
      const ls = wl[11], rs = wl[12];
      if (isVis(ls) && isVis(rs)) {
        const dx = rs.x - ls.x; // negative when facing camera (right at neg-X, left at pos-X)
        const dz = rs.z - ls.z;
        const yaw = Math.atan2(dz, -dx) * 0.65;
        const rest = restData.get(store.hips)!;
        targets.set(
          store.hips,
          rest.localQuat.clone().multiply(
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
          )
        );
      }
    }

    // ── Spine lateral lean ─────────────────────────────────────────────
    if (store.spine) {
      const ls = wl[11], rs = wl[12], lh = wl[23], rh = wl[24];
      if (isVis(ls) && isVis(rs) && isVis(lh) && isVis(rh)) {
        const smx = (ls.x + rs.x) / 2, smy = (ls.y + rs.y) / 2;
        const hmx = (lh.x + rh.x) / 2, hmy = (lh.y + rh.y) / 2;
        const lean = Math.atan2(smx - hmx, Math.max(0.01, smy - hmy)) * 0.45;
        const rest = restData.get(store.spine)!;
        targets.set(
          store.spine,
          rest.localQuat.clone().multiply(
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -lean)
          )
        );
      }
    }

    // ── Avatar LEFT arm ← user's RIGHT arm (MP 12 → 14 → 16) ──────────
    if (isVis(wl[12]) && isVis(wl[14]))
      set(store.lUpperArm, restData.get(store.lUpperArm!), worldDir(wl[14], wl[12]));
    if (isVis(wl[14]) && isVis(wl[16]))
      set(store.lForeArm, restData.get(store.lForeArm!), worldDir(wl[16], wl[14]));

    // ── Avatar RIGHT arm ← user's LEFT arm (MP 11 → 13 → 15) ──────────
    if (isVis(wl[11]) && isVis(wl[13]))
      set(store.rUpperArm, restData.get(store.rUpperArm!), worldDir(wl[13], wl[11]));
    if (isVis(wl[13]) && isVis(wl[15]))
      set(store.rForeArm, restData.get(store.rForeArm!), worldDir(wl[15], wl[13]));
  }

  // ── Fingers ───────────────────────────────────────────────────────────
  const applyFingers = (fingers: HandFingers, lms: Landmark2D[]) => {
    for (let f = 0; f < 5; f++) {
      const bones = fingers[f];
      const pairs = FINGER_PAIRS[f];
      for (let j = 0; j < 2; j++) {
        const bone = bones[j], child = bones[j + 1];
        if (!bone || !child) continue;
        const rest = restData.get(bone);
        if (!rest) continue;
        const [pi, ci] = pairs[j];
        if (!lms[pi] || !lms[ci]) continue;
        const dir = handDir(lms[ci], lms[pi]);
        if (dir.lengthSq() < 1e-10) continue;
        targets.set(bone, computeAimTarget(bone, rest, dir));
      }
    }
  };

  if (rhLms) applyFingers(store.lFingers, rhLms);
  if (lhLms) applyFingers(store.rFingers, lhLms);

  return targets;
}

// ─── Component ─────────────────────────────────────────────────────────────

const ALPHA_BODY = 0.14;
const ALPHA_FINGER = 0.22;

export default function AvatarScene() {
  const mountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState("Initializing…");

  const holisticDataRef = useRef<HolisticResults | null>(null);
  const boneStoreRef = useRef<BoneStore | null>(null);
  const restDataRef = useRef<Map<THREE.Bone, BoneRestData>>(new Map());
  const smoothedRef = useRef<Map<THREE.Bone, THREE.Quaternion>>(new Map());

  useMediaPipeHolistic(
    videoRef,
    (results) => {
      holisticDataRef.current = results;
      const hasBody = (results.poseWorldLandmarks?.length ?? 0) > 0;
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
      new URL("/avatar_full_rig.glb", window.location.origin).href,
      (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(0.1);
        scene.add(model);

        // Frame camera on upper body
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const torsoY = center.y + size.y * 0.1;
        camera.position.set(center.x, torsoY, size.y * 0.55 + 0.5);
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
    </div>
  );
}
