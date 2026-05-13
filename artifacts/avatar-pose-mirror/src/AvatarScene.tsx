import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useMediaPipePose, PoseResults } from "./useMediaPipePose";
import { findBone, aimBone } from "./boneUtils";

interface BoneChain {
  bone: THREE.Bone;
  child: THREE.Bone;
  restLocalQuat: THREE.Quaternion;
  mpParentIdx: number;
  mpChildIdx: number;
}

export default function AvatarScene() {
  const mountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState("Initializing…");

  const poseResultsRef = useRef<PoseResults | null>(null);
  const boneChainsRef = useRef<BoneChain[]>([]);

  useMediaPipePose(
    videoRef,
    (results) => {
      poseResultsRef.current = results;
      if (results.poseLandmarks && results.poseLandmarks.length > 0) {
        setStatus("Pose detected");
      } else {
        setStatus("No pose detected");
      }
    },
    (statusMsg) => setStatus(statusMsg)
  );

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    setStatus("Loading avatar…");

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

    const camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.01,
      100
    );
    camera.position.set(0, 1.5, 2.5);
    camera.lookAt(0, 1, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(0.5, 2, 2);
    scene.add(dirLight);

    let animFrameId: number;

    const loader = new GLTFLoader();

    const avatarUrl = new URL("/avatar.glb", window.location.origin).href;

    loader.load(
      avatarUrl,
      (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(0.1);
        scene.add(model);

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        const torsoY = center.y + size.y * 0.15;
        camera.position.set(center.x, torsoY, size.y * 0.6 + 0.5);
        camera.lookAt(center.x, torsoY, center.z);

        const root = model;

        const rUpperArm = findBone(root, [
          ["leftarm"],
          ["upperarm", "l"],
          ["arm", "l"],
        ]);
        const rForeArm = findBone(root, [
          ["leftforearm"],
          ["forearm", "l"],
          ["lowerarm", "l"],
        ]);
        const rHand = findBone(root, [
          ["lefthand"],
          ["hand", "l"],
          ["wrist", "l"],
        ]);

        const lUpperArm = findBone(root, [
          ["rightarm"],
          ["upperarm", "r"],
          ["arm", "r"],
        ]);
        const lForeArm = findBone(root, [
          ["rightforearm"],
          ["forearm", "r"],
          ["lowerarm", "r"],
        ]);
        const lHand = findBone(root, [
          ["righthand"],
          ["hand", "r"],
          ["wrist", "r"],
        ]);

        const chains: BoneChain[] = [];

        if (rUpperArm && rForeArm) {
          chains.push({
            bone: rUpperArm,
            child: rForeArm,
            restLocalQuat: rUpperArm.quaternion.clone(),
            mpParentIdx: 11,
            mpChildIdx: 13,
          });
        }
        if (rForeArm && rHand) {
          chains.push({
            bone: rForeArm,
            child: rHand,
            restLocalQuat: rForeArm.quaternion.clone(),
            mpParentIdx: 13,
            mpChildIdx: 15,
          });
        }
        if (lUpperArm && lForeArm) {
          chains.push({
            bone: lUpperArm,
            child: lForeArm,
            restLocalQuat: lUpperArm.quaternion.clone(),
            mpParentIdx: 12,
            mpChildIdx: 14,
          });
        }
        if (lForeArm && lHand) {
          chains.push({
            bone: lForeArm,
            child: lHand,
            restLocalQuat: lForeArm.quaternion.clone(),
            mpParentIdx: 14,
            mpChildIdx: 16,
          });
        }

        boneChainsRef.current = chains;
        setStatus("Waiting for camera…");
      },
      undefined,
      (err) => {
        console.error("GLB load error", err);
        setStatus("Failed to load avatar");
      }
    );

    function applyPose() {
      const results = poseResultsRef.current;
      const chains = boneChainsRef.current;
      if (!results?.poseLandmarks || chains.length === 0) return;

      const lms = results.poseLandmarks;

      const upperArmChains = chains.filter(
        (c) => c.mpParentIdx === 11 || c.mpParentIdx === 12
      );
      const foreArmChains = chains.filter(
        (c) => c.mpParentIdx === 13 || c.mpParentIdx === 14
      );

      for (const chain of [...upperArmChains, ...foreArmChains]) {
        const parent = lms[chain.mpParentIdx];
        const child = lms[chain.mpChildIdx];
        if (!parent || !child) continue;
        if ((parent.visibility ?? 1) < 0.3 || (child.visibility ?? 1) < 0.3) continue;

        const dx = -(child.x - parent.x);
        const dy = -(child.y - parent.y);
        const targetDir = new THREE.Vector3(dx, dy, 0).normalize();
        if (targetDir.lengthSq() < 1e-10) continue;

        aimBone(chain.bone, chain.child, chain.restLocalQuat, targetDir);
      }
    }

    function render() {
      animFrameId = requestAnimationFrame(render);
      applyPose();
      renderer.render(scene, camera);
    }
    render();

    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (mountEl.contains(renderer.domElement)) {
        mountEl.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#000" }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />

      <div
        style={{
          position: "fixed",
          top: 12,
          left: 12,
          color: "#00ff88",
          fontFamily: "monospace",
          fontSize: 13,
          background: "rgba(0,0,0,0.5)",
          padding: "4px 10px",
          borderRadius: 4,
          pointerEvents: "none",
          zIndex: 10,
        }}
      >
        {status}
      </div>

      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          position: "fixed",
          bottom: 12,
          right: 12,
          width: 200,
          height: 150,
          objectFit: "cover",
          transform: "scaleX(-1)",
          borderRadius: 8,
          border: "2px solid rgba(0,255,136,0.4)",
          zIndex: 10,
        }}
      />
    </div>
  );
}
