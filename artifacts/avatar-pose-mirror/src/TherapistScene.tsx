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

// ─── Bone discovery (same keyword patterns as AvatarScene) ─────────────────

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
    lCalf:  fb([["lcalf"],  ["calfl"],  ["leftcalf"],  ["lleg"],  ["leftleg"]]),
    rCalf:  fb([["rcalf"],  ["calfr"],  ["rightcalf"], ["rleg"],  ["rightleg"]]),
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

  euler(store.hips); euler(store.spine); euler(store.spine1);
  euler(store.neck); euler(store.head);
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

  const captureFoot = (b: THREE.Bone | null) => {
    if (!b) return;
    const toe = b.children.find((c) => c instanceof THREE.Bone) as THREE.Bone | undefined;
    if (toe) {
      map.set(b, captureArmRestData(b, toe));
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

// ─── Pose computation (DIRECT mapping — no left/right swap) ────────────────

function computeTherapistTargets(
  data: { poseLandmarks?: Lm3[]; poseWorldLandmarks?: Lm3[] },
  store: BoneStore,
  restData: Map<THREE.Bone, BoneRestData>,
  torsoAngles: { lean: number; pitch: number; yaw: number }
): Map<THREE.Bone, THREE.Quaternion> {
  const targets = new Map<THREE.Bone, THREE.Quaternion>();

  const imgLm  = data.poseLandmarks;
  const wrldLm = (data.poseWorldLandmarks?.length ?? 0) > 0
    ? data.poseWorldLandmarks!
    : (data.poseLandmarks ?? []);

  if (!imgLm || imgLm.length < 25) return targets;

  const isVis = (lm: Lm3) => (lm.visibility ?? 1) >= 0.3;
  const deg = THREE.MathUtils.degToRad;

  // Direction from parent joint to child joint; negate all axes to convert
  // MediaPipe world → Three.js world for a forward-facing avatar.
  const dir = (idxChild: number, idxParent: number) => {
    const c = wrldLm[idxChild], p = wrldLm[idxParent];
    const v = new THREE.Vector3(-(c.x - p.x), -(c.y - p.y), -(c.z - p.z));
    return v.lengthSq() < 1e-8 ? new THREE.Vector3(0, -1, 0) : v.normalize();
  };

  // ── 1. Spine lean ───────────────────────────────────────────────────────
  const TORSO_ALPHA = 0.12;
  const lsV = (wrldLm[11]?.visibility ?? 1) >= 0.5;
  const rsV = (wrldLm[12]?.visibility ?? 1) >= 0.5;
  let invTorsoQ = new THREE.Quaternion();

  if (store.spine && lsV && rsV) {
    const ls = wrldLm[11], rs = wrldLm[12];
    const dy = rs.y - ls.y;
    const dx = Math.abs(rs.x - ls.x);
    const rawLean = -Math.atan2(dy, Math.max(0.01, dx));
    const DEAD = deg(3);
    const lean = Math.abs(rawLean) < DEAD
      ? 0
      : THREE.MathUtils.clamp(rawLean * 1.2, -deg(60), deg(60));

    torsoAngles.lean += TORSO_ALPHA * (lean - torsoAngles.lean);

    const halfQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1), torsoAngles.lean * 0.5
    );
    targets.set(store.spine,  restData.get(store.spine)!.localQuat.clone().multiply(halfQ));
    if (store.spine1) {
      targets.set(store.spine1, restData.get(store.spine1)!.localQuat.clone().multiply(halfQ));
    }
    invTorsoQ = halfQ.clone().invert();
  } else if (store.spine) {
    torsoAngles.lean *= (1 - TORSO_ALPHA);
    targets.set(store.spine,  restData.get(store.spine)!.localQuat.clone());
    if (store.spine1) targets.set(store.spine1, restData.get(store.spine1)!.localQuat.clone());
  }

  // ── 2. Arm chains (DIRECT: left-video → Suzie-left, right-video → Suzie-right) ─
  const applyArm = (
    sIdx: number, eIdx: number, wIdx: number,
    upper: THREE.Bone | null, fore: THREE.Bone | null,
    isLeft: boolean
  ) => {
    if (!upper || !isVis(imgLm[sIdx]) || !isVis(imgLm[eIdx])) return;

    const rU = dir(eIdx, sIdx).applyQuaternion(invTorsoQ);
    targets.set(upper, computeAimTarget(upper, restData.get(upper)!, rU));

    if (!fore || !isVis(imgLm[wIdx])) return;
    const rF = dir(wIdx, eIdx).applyQuaternion(invTorsoQ);
    const upperSwing = new THREE.Quaternion().setFromUnitVectors(
      restData.get(upper)!.worldDir, rU
    );
    const localFore = rF.clone().applyQuaternion(upperSwing.clone().invert());
    if (!isLeft) {
      localFore.x = -localFore.x;
      localFore.y = -localFore.y;
      localFore.z = -localFore.z;
    }
    targets.set(fore, computeAimTarget(fore, restData.get(fore)!, localFore));
  };

  // Direct: video left (11,13,15) → Suzie left arm
  applyArm(11, 13, 15, store.lUpperArm, store.lForeArm, true);
  // Direct: video right (12,14,16) → Suzie right arm
  applyArm(12, 14, 16, store.rUpperArm, store.rForeArm, false);

  // ── 3. Head & neck ──────────────────────────────────────────────────────
  if (isVis(imgLm[0]) && isVis(imgLm[7]) && isVis(imgLm[8])) {
    const nose = wrldLm[0], earL = wrldLm[7], earR = wrldLm[8];
    const earDX  = Math.max(0.01, Math.abs(earR.x - earL.x));
    const pitch  = THREE.MathUtils.clamp(Math.atan2(nose.y - (earL.y + earR.y) / 2, 0.2), -deg(30), deg(40));
    const yaw    = THREE.MathUtils.clamp(-Math.atan2(earL.z - earR.z, earDX), -deg(70), deg(70));
    const roll   = THREE.MathUtils.clamp(Math.atan2(earR.y - earL.y, earDX), -deg(30), deg(30));

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

// ─── CDN loader (deduplicates against AvatarScene's loader) ────────────────

const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1675471629";

function loadHolisticCDN(): Promise<new (opts: object) => any> {
  const w = window as any;
  if (w.Holistic) return Promise.resolve(w.Holistic);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${CDN}/holistic.js"]`);
    if (existing) {
      const poll = setInterval(() => {
        if ((window as any).Holistic) { clearInterval(poll); resolve((window as any).Holistic); }
      }, 100);
      setTimeout(() => { clearInterval(poll); reject(new Error("MediaPipe CDN timeout")); }, 30000);
      return;
    }
    const script = document.createElement("script");
    script.src = `${CDN}/holistic.js`;
    script.crossOrigin = "anonymous";
    script.onload  = () => (window as any).Holistic ? resolve((window as any).Holistic) : reject(new Error("Holistic not on window"));
    script.onerror = () => reject(new Error("CDN load failed"));
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
    let holisticInstance: any = null;

    // ── Three.js setup ─────────────────────────────────────────────────────
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

    // Lights matching AvatarScene palette
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(0.5, 2, 2);
    scene.add(dir);
    scene.add(Object.assign(new THREE.DirectionalLight(0x8899ff, 0.3), { position: new THREE.Vector3(-1, 0.5, -1) }));

    // Mini floor grid (same blue tint)
    const gridColor = new THREE.Color(0x114488);
    const grid = new THREE.GridHelper(3, 20, gridColor, gridColor);
    scene.add(grid);

    // ── Bone state ─────────────────────────────────────────────────────────
    const boneStoreRef   = { current: null as BoneStore | null };
    const restDataRef    = { current: new Map<THREE.Bone, BoneRestData>() };
    const smoothedRef    = { current: new Map<THREE.Bone, THREE.Quaternion>() };
    const poseResultRef  = { current: null as any };
    const torsoAngles    = { lean: 0, pitch: 0, yaw: 0 };

    // ── Load Suzie FBX ─────────────────────────────────────────────────────
    setStatus("Loading Suzie…");
    new FBXLoader().load(
      new URL("/Therapist_Suzie.fbx", window.location.origin).href,
      (fbx) => {
        if (stopped) return;
        fbx.scale.setScalar(0.01);
        scene.add(fbx);
        fbx.updateMatrixWorld(true);

        // Auto-frame
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

        // Bone setup
        const store    = buildTherapistBoneStore(fbx);
        const restData = buildRestData(store);
        const smoothed = new Map<THREE.Bone, THREE.Quaternion>();
        for (const [bone, rd] of restData) smoothed.set(bone, rd.localQuat.clone());

        boneStoreRef.current  = store;
        restDataRef.current   = restData;
        smoothedRef.current   = smoothed;
        setStatus("Waiting for video…");
      },
      undefined,
      () => { if (!stopped) setStatus("Failed to load Suzie"); }
    );

    // ── Video setup ────────────────────────────────────────────────────────
    const videoUrl = `/api/exercises/video?object=${encodeURIComponent(objectPath)}`;
    videoEl.src          = videoUrl;
    videoEl.crossOrigin  = "anonymous";
    videoEl.loop         = true;
    videoEl.muted        = true;
    videoEl.playsInline  = true;
    videoEl.play().catch(() => {});

    videoEl.addEventListener("canplay", () => {
      if (!stopped) setStatus("Tracking therapist…");
    });

    // ── MediaPipe Holistic ─────────────────────────────────────────────────
    loadHolisticCDN()
      .then((HolisticClass) => {
        if (stopped) return;
        const holistic = new HolisticClass({ locateFile: (f: string) => `${CDN}/${f}` });
        holistic.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          enableSegmentation: false,
          refineFaceLandmarks: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        holistic.onResults((results: any) => { poseResultRef.current = results; });
        holisticInstance = holistic;
      })
      .catch(() => { if (!stopped) setStatus("Pose model unavailable"); });

    // ── Render loop ────────────────────────────────────────────────────────
    function renderLoop() {
      if (stopped) return;
      animFrameId = requestAnimationFrame(renderLoop);

      // Fire-and-forget MediaPipe frame send
      if (
        holisticInstance &&
        (videoEl?.readyState ?? 0) >= 2 &&
        !videoEl?.paused &&
        !sendingFrame
      ) {
        sendingFrame = true;
        holisticInstance
          .send({ image: videoEl })
          .catch(() => {})
          .finally(() => { sendingFrame = false; });
      }

      // Apply pose data to Suzie
      const store    = boneStoreRef.current;
      const restData = restDataRef.current;
      const smoothed = smoothedRef.current;
      const data     = poseResultRef.current;

      if (store && data) {
        for (const [bone, rd] of restData) bone.quaternion.copy(rd.localQuat);
        (store.root.parent ?? store.root).updateMatrixWorld(true);

        const targets = computeTherapistTargets(data, store, restData, torsoAngles);

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

    // ── Resize observer ────────────────────────────────────────────────────
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

    // ── Cleanup ────────────────────────────────────────────────────────────
    return () => {
      stopped = true;
      cancelAnimationFrame(animFrameId);
      holisticInstance?.close?.();
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
