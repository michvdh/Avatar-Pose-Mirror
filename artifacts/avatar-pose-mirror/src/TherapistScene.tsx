import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import {
  findBone,
  captureArmRestData,
  captureEulerRestData,
  BoneRestData,
  computeAimTarget,
  slerpBone,
} from "./boneUtils";

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

interface Lm3 { x: number; y: number; z: number; visibility?: number }

// ─── Bone discovery ────────────────────────────────────────────────────────

function buildTherapistBoneStore(root: THREE.Object3D): BoneStore {
  const fb = (sets: string[][]) => findBone(root, sets);
  return {
    root,
    hips:   fb([["pelvis"], ["hips"], ["hip"]]),
    spine:  fb([["spine01"], ["spine"], ["torso"]]),
    spine1: fb([["spine02"], ["spine1"], ["spine2"], ["chest"], ["upperchest"]]),
    neck:   fb([["neck"], ["neck01"]]),
    head:   fb([["head"]]),
    lShoulder: fb([["lclavicle"], ["claviclel"], ["leftshoulder"], ["lshoulder"], ["leftclavicle"]]),
    rShoulder: fb([["rclavicle"], ["clavicler"], ["rightshoulder"], ["rshoulder"], ["rightclavicle"]]),
    lUpperArm: fb([["lupperarm"], ["upperarml"], ["leftupperarm"], ["leftarm"]]),
    lForeArm:  fb([["lforearm"],  ["lowerarml"], ["leftforearm"]]),
    lHand:     fb([["lhand"],     ["handl"],      ["lefthand"]]),
    rUpperArm: fb([["rupperarm"], ["upperarmr"], ["rightupperarm"], ["rightarm"]]),
    rForeArm:  fb([["rforearm"],  ["lowerarmr"], ["rightforearm"]]),
    rHand:     fb([["rhand"],     ["handr"],      ["righthand"]]),
    lThigh: fb([["lthigh"], ["thighl"], ["leftthigh"], ["lupleg"], ["leftupleg"]]),
    rThigh: fb([["rthigh"], ["thighr"], ["rightthigh"], ["rupleg"], ["rightupleg"]]),
    lCalf:  fb([["lcalf"],  ["calfl"],  ["leftcalf"],  ["lleg"],   ["leftleg"]]),
    rCalf:  fb([["rcalf"],  ["calfr"],  ["rightcalf"], ["rleg"],   ["rightleg"]]),
    lFoot:  fb([["lfoot"],  ["footl"],  ["leftfoot"]]),
    rFoot:  fb([["rfoot"],  ["footr"],  ["rightfoot"]]),
  };
}

// ─── Rest-data capture ─────────────────────────────────────────────────────

function buildRestData(store: BoneStore): Map<THREE.Bone, BoneRestData> {
  const map = new Map<THREE.Bone, BoneRestData>();
  const chain = (a: THREE.Bone | null, b: THREE.Bone | null) => {
    if (a && b) map.set(a, captureArmRestData(a, b));
  };
  const euler = (b: THREE.Bone | null) => { if (b) map.set(b, captureEulerRestData(b)); };

  euler(store.hips);  euler(store.spine); euler(store.spine1);
  euler(store.neck);  euler(store.head);
  euler(store.lShoulder); euler(store.rShoulder);
  euler(store.lHand); euler(store.rHand);

  chain(store.lUpperArm, store.lForeArm);
  chain(store.lForeArm,  store.lHand);
  chain(store.rUpperArm, store.rForeArm);
  chain(store.rForeArm,  store.rHand);
  chain(store.lThigh, store.lCalf);
  chain(store.rThigh, store.rCalf);
  chain(store.lCalf,  store.lFoot);
  chain(store.rCalf,  store.rFoot);

  return map;
}

// ─── Pose computation (DIRECT — video left → Suzie left) ──────────────────

function computeTargets(
  poseLm: Lm3[],
  worldLm: Lm3[],
  store: BoneStore,
  restData: Map<THREE.Bone, BoneRestData>,
  torsoAngles: { lean: number }
): Map<THREE.Bone, THREE.Quaternion> {
  const targets = new Map<THREE.Bone, THREE.Quaternion>();

  if (poseLm.length < 25) return targets;

  const isVis = (lm: Lm3) => (lm.visibility ?? 1) >= 0.3;
  const deg = THREE.MathUtils.degToRad;

  // World direction: negate all axes to convert MediaPipe → Three.js
  const wDir = (idxC: number, idxP: number) => {
    const c = worldLm[idxC], p = worldLm[idxP];
    const v = new THREE.Vector3(-(c.x - p.x), -(c.y - p.y), -(c.z - p.z));
    return v.lengthSq() < 1e-8 ? new THREE.Vector3(0, -1, 0) : v.normalize();
  };

  // ── Spine lean ────────────────────────────────────────────────────────────
  const ALPHA = 0.12;
  const lsV = (worldLm[11]?.visibility ?? 1) >= 0.5;
  const rsV = (worldLm[12]?.visibility ?? 1) >= 0.5;
  let invTorsoQ = new THREE.Quaternion();

  if (store.spine && lsV && rsV) {
    const ls = worldLm[11], rs = worldLm[12];
    const dy = rs.y - ls.y;
    const dx = Math.abs(rs.x - ls.x);
    const rawLean = -Math.atan2(dy, Math.max(0.01, dx));
    const DEAD = deg(3);
    const lean = Math.abs(rawLean) < DEAD ? 0
      : THREE.MathUtils.clamp(rawLean * 1.2, -deg(60), deg(60));
    torsoAngles.lean += ALPHA * (lean - torsoAngles.lean);

    const halfQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1), torsoAngles.lean * 0.5
    );
    targets.set(store.spine,  restData.get(store.spine)!.localQuat.clone().multiply(halfQ));
    if (store.spine1)
      targets.set(store.spine1, restData.get(store.spine1)!.localQuat.clone().multiply(halfQ));
    invTorsoQ = halfQ.clone().invert();
  } else if (store.spine) {
    torsoAngles.lean *= (1 - ALPHA);
    targets.set(store.spine,  restData.get(store.spine)!.localQuat.clone());
    if (store.spine1) targets.set(store.spine1, restData.get(store.spine1)!.localQuat.clone());
  }

  // ── Arm chains (direct aim — avoids elbow-inward artefact on raised arms) ──
  const applyArm = (
    sIdx: number, eIdx: number, wIdx: number,
    upper: THREE.Bone | null, fore: THREE.Bone | null,
  ) => {
    if (!upper || !isVis(poseLm[sIdx]) || !isVis(poseLm[eIdx])) return;
    const rU = wDir(eIdx, sIdx).applyQuaternion(invTorsoQ);
    targets.set(upper, computeAimTarget(upper, restData.get(upper)!, rU));

    if (!fore || !isVis(poseLm[wIdx])) return;
    // Aim the forearm directly in world-space — no swing decomposition needed
    const rF = wDir(wIdx, eIdx).applyQuaternion(invTorsoQ);
    targets.set(fore, computeAimTarget(fore, restData.get(fore)!, rF));
  };

  // video left (11,13,15) → Suzie left arm
  applyArm(11, 13, 15, store.lUpperArm, store.lForeArm);
  // video right (12,14,16) → Suzie right arm
  applyArm(12, 14, 16, store.rUpperArm, store.rForeArm);

  // ── Head & neck ───────────────────────────────────────────────────────────
  if (isVis(poseLm[0]) && isVis(poseLm[7]) && isVis(poseLm[8])) {
    const nose = worldLm[0], earL = worldLm[7], earR = worldLm[8];
    const earDX = Math.max(0.01, Math.abs(earR.x - earL.x));
    const pitch = THREE.MathUtils.clamp(
      Math.atan2(nose.y - (earL.y + earR.y) / 2, 0.2), -deg(30), deg(40)
    );
    const yaw = THREE.MathUtils.clamp(
      -Math.atan2(earL.z - earR.z, earDX), -deg(70), deg(70)
    );
    const roll = THREE.MathUtils.clamp(
      Math.atan2(earR.y - earL.y, earDX), -deg(30), deg(30)
    );

    const faceQ = new THREE.Quaternion()
      .multiplyQuaternions(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw   * 0.85),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch * 1.1)
      )
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -roll * 0.8));

    const masterQ = invTorsoQ.clone().multiply(faceQ);
    const neckQ   = new THREE.Quaternion().slerp(masterQ, 0.4);
    const headQ   = masterQ.clone().multiply(neckQ.clone().invert());

    if (store.neck) targets.set(store.neck, restData.get(store.neck)!.localQuat.clone().multiply(neckQ));
    if (store.head) targets.set(store.head, restData.get(store.head)!.localQuat.clone().multiply(headQ));
  }

  return targets;
}

// ─── @mediapipe/pose CDN loader (separate WASM from Holistic — no conflict) ─

const POSE_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404";

function loadPoseCDN(): Promise<new (opts: object) => any> {
  const w = window as any;
  if (w.Pose) return Promise.resolve(w.Pose);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${POSE_CDN}/pose.js"]`);
    if (existing) {
      const poll = setInterval(() => {
        if ((window as any).Pose) { clearInterval(poll); resolve((window as any).Pose); }
      }, 100);
      setTimeout(() => { clearInterval(poll); reject(new Error("Pose CDN timeout")); }, 30000);
      return;
    }
    const script = document.createElement("script");
    script.src = `${POSE_CDN}/pose.js`;
    script.crossOrigin = "anonymous";
    script.onload  = () => (window as any).Pose
      ? resolve((window as any).Pose)
      : reject(new Error("Pose not on window after load"));
    script.onerror = () => reject(new Error("Pose CDN failed to load"));
    document.head.appendChild(script);
  });
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function TherapistScene({ objectPath }: { objectPath: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState("Loading…");

  useEffect(() => {
    const mountEl = mountRef.current;
    const videoEl = videoRef.current;
    if (!mountEl || !videoEl) return;

    let stopped = false;
    let animFrameId: number;
    let sendingFrame = false;
    let poseInstance: any = null;

    // ── Three.js ────────────────────────────────────────────────────────────
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setStatus("WebGL unavailable");
      return;
    }

    const W = mountEl.clientWidth  || 280;
    const H = mountEl.clientHeight || 400;
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x060d1f);
    mountEl.appendChild(renderer.domElement);

    const scene  = new THREE.Scene();
    scene.background = new THREE.Color("#060d1f");
    scene.fog = new THREE.FogExp2("#060d1f", 0.08);

    const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 50);
    camera.position.set(0, 1.5, 2.5);
    camera.lookAt(0, 1, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(0.5, 2, 2);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0xddeeff, 1.2);
    fillLight.position.set(0, 1, 3);
    scene.add(fillLight);
    const backLight = new THREE.DirectionalLight(0x8899ff, 0.5);
    backLight.position.set(-1, 0.5, -1);
    scene.add(backLight);

    // ── Bone state ──────────────────────────────────────────────────────────
    const boneStoreRef  = { current: null as BoneStore | null };
    const restDataRef   = { current: new Map<THREE.Bone, BoneRestData>() };
    const smoothedRef   = { current: new Map<THREE.Bone, THREE.Quaternion>() };
    const poseResultRef = { current: null as { poseLandmarks: Lm3[]; poseWorldLandmarks: Lm3[] } | null };
    const torsoAngles   = { lean: 0 };

    // ── Load Suzie FBX ──────────────────────────────────────────────────────
    setStatus("Loading Suzie…");
    new FBXLoader().load(
      new URL("/Therapist_Suzie.fbx", window.location.origin).href,
      (fbx) => {
        if (stopped) return;
        fbx.scale.setScalar(0.01);
        scene.add(fbx);
        fbx.updateMatrixWorld(true);

        const box    = new THREE.Box3().setFromObject(fbx);
        const center = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const fovRad = THREE.MathUtils.degToRad(camera.fov);
        const zDist  = Math.max(
          (size.y / 2) / Math.tan(fovRad / 2),
          (size.x / 2) / (Math.tan(fovRad / 2) * camera.aspect)
        ) * 1.6;
        camera.position.set(center.x, center.y, center.z + zDist);
        camera.lookAt(center.x, center.y, center.z);

        const store    = buildTherapistBoneStore(fbx);
        const restData = buildRestData(store);
        const smoothed = new Map<THREE.Bone, THREE.Quaternion>();
        for (const [bone, rd] of restData) smoothed.set(bone, rd.localQuat.clone());

        boneStoreRef.current = store;
        restDataRef.current  = restData;
        smoothedRef.current  = smoothed;
        setStatus("Loading pose model…");
      },
      undefined,
      () => { if (!stopped) setStatus("Failed to load Suzie"); }
    );

    // ── Video setup ──────────────────────────────────────────────────────────
    videoEl.src         = `/api/exercises/video?object=${encodeURIComponent(objectPath)}`;
    videoEl.crossOrigin = "anonymous";
    videoEl.loop        = true;
    videoEl.muted       = true;
    videoEl.playsInline = true;
    videoEl.play().catch(() => {});

    // ── @mediapipe/pose (separate WASM — no conflict with Holistic) ──────────
    loadPoseCDN()
      .then((PoseClass) => {
        if (stopped) return;
        const pose = new PoseClass({ locateFile: (f: string) => `${POSE_CDN}/${f}` });
        pose.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          enableSegmentation: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        pose.onResults((results: any) => {
          if (results.poseLandmarks && results.poseWorldLandmarks) {
            poseResultRef.current = results;
            if (status !== "Tracking therapist") setStatus("Tracking therapist");
          }
        });
        poseInstance = pose;
        setStatus("Waiting for video…");
      })
      .catch(() => { if (!stopped) setStatus("Pose model failed"); });

    // ── Render loop ──────────────────────────────────────────────────────────
    function renderLoop() {
      if (stopped) return;
      animFrameId = requestAnimationFrame(renderLoop);

      if (
        poseInstance &&
        (videoEl?.readyState ?? 0) >= 2 &&
        !videoEl?.paused &&
        !sendingFrame
      ) {
        sendingFrame = true;
        poseInstance
          .send({ image: videoEl })
          .catch(() => {})
          .finally(() => { sendingFrame = false; });
      }

      const store    = boneStoreRef.current;
      const restData = restDataRef.current;
      const smoothed = smoothedRef.current;
      const data     = poseResultRef.current;

      if (store && data?.poseLandmarks && data?.poseWorldLandmarks) {
        for (const [bone, rd] of restData) bone.quaternion.copy(rd.localQuat);
        (store.root.parent ?? store.root).updateMatrixWorld(true);

        const targets = computeTargets(
          data.poseLandmarks,
          data.poseWorldLandmarks,
          store,
          restData,
          torsoAngles
        );

        for (const [bone, target] of targets) {
          const sm = smoothed.get(bone);
          if (!sm) continue;
          const alpha = THREE.MathUtils.clamp(sm.angleTo(target) * 2, 0.1, 0.35);
          slerpBone(bone, sm, target, alpha);
        }
        for (const [bone, sm] of smoothed) {
          if (!targets.has(bone)) bone.quaternion.copy(sm);
        }
      }

      renderer.render(scene, camera);
    }
    renderLoop();

    // ── Resize observer ──────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const w2 = mountEl.clientWidth;
      const h2 = mountEl.clientHeight;
      if (w2 > 0 && h2 > 0) {
        renderer.setSize(w2, h2);
        camera.aspect = w2 / h2;
        camera.updateProjectionMatrix();
      }
    });
    ro.observe(mountEl);

    // ── Cleanup ──────────────────────────────────────────────────────────────
    return () => {
      stopped = true;
      cancelAnimationFrame(animFrameId);
      poseInstance?.close?.();
      ro.disconnect();
      renderer.dispose();
      if (mountEl.contains(renderer.domElement)) mountEl.removeChild(renderer.domElement);
      videoEl?.pause();
      if (videoEl) videoEl.src = "";
    };
  }, [objectPath]);

  return (
    <div ref={mountRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <video ref={videoRef} style={{ display: "none" }} />
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 8,
          color: "#00aaff",
          fontFamily: "monospace",
          fontSize: 10,
          background: "rgba(0,0,0,0.55)",
          padding: "3px 8px",
          borderRadius: 3,
          pointerEvents: "none",
        }}
      >
        {status}
      </div>
    </div>
  );
}
