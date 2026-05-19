import * as THREE from "three";

// ─── Bone discovery ───────────────────────────────────────────────────────────

/**
 * Find the first Bone in a skeleton whose lowercased name (stripped of
 * spaces/underscores/hyphens) contains ALL of the keywords in at least one
 * keyword set.  Multiple keyword sets act as fallbacks – the first set to
 * match wins.
 */
export function findBone(
  root: THREE.Object3D,
  keywordSets: string[][]
): THREE.Bone | null {
  for (const keywords of keywordSets) {
    let found: THREE.Bone | null = null;
    root.traverse((obj) => {
      if (found) return;
      if (obj instanceof THREE.Bone) {
        const n = obj.name.toLowerCase().replace(/[\s_\-]/g, "");
        if (keywords.every((kw) => n.includes(kw.toLowerCase().replace(/[\s_\-]/g, "")))) {
          found = obj;
        }
      }
    });
    if (found) return found;
  }
  return null;
}

// ─── Rest-pose capture ────────────────────────────────────────────────────────

export interface BoneRestData {
  /** Local quaternion captured at rest pose */
  localQuat: THREE.Quaternion;
  /**
   * World-space unit direction from bone to child, captured at rest.
   * Only set for bones that use direction-based aiming.
   */
  worldDir: THREE.Vector3;
}

/**
 * Capture rest-pose data for a bone that will be driven by aiming it toward
 * a world-space direction (upper arm, forearm, finger joints, etc.).
 * Call ONCE after the GLB loads, before any animation.
 */
export function captureArmRestData(
  bone: THREE.Bone,
  child: THREE.Bone
): BoneRestData {
  const boneWorldPos = new THREE.Vector3();
  const childWorldPos = new THREE.Vector3();
  bone.getWorldPosition(boneWorldPos);
  child.getWorldPosition(childWorldPos);
  return {
    localQuat: bone.quaternion.clone(),
    worldDir: childWorldPos.clone().sub(boneWorldPos).normalize(),
  };
}

/**
 * Capture rest-pose data for a bone driven by Euler angles (hips, spine,
 * neck, head).  worldDir is set to world-up as a placeholder.
 */
export function captureEulerRestData(bone: THREE.Bone): BoneRestData {
  return {
    localQuat: bone.quaternion.clone(),
    worldDir: new THREE.Vector3(0, 1, 0),
  };
}

// ─── Target quaternion computation ────────────────────────────────────────────

/**
 * Compute the local quaternion that makes 'bone' aim toward 'targetWorldDir',
 * using the rest-pose world direction as the reference.
 *
 * Assumptions:
 *   • All bones have been reset to their rest local quaternion and world
 *     matrices have been updated before calling this function.
 *   • 'restData.worldDir' was captured in that same rest state.
 */
export function computeAimTarget(
  bone: THREE.Bone,
  restData: BoneRestData,
  targetWorldDir: THREE.Vector3
): THREE.Quaternion {
  const tNorm = targetWorldDir.clone().normalize();
  if (tNorm.lengthSq() < 1e-12 || restData.worldDir.lengthSq() < 1e-12) {
    return restData.localQuat.clone();
  }

  // delta rotates the rest-world-direction onto the target-world-direction
  const delta = new THREE.Quaternion().setFromUnitVectors(restData.worldDir, tNorm);

  // Apply delta in world space (from rest world orientation)
  // currentRestWorldQuat = parent_current_world_quat * restLocalQuat
  const parentWorldQuat = new THREE.Quaternion();
  if (bone.parent) bone.parent.getWorldQuaternion(parentWorldQuat);
  const currentRestWorldQuat = parentWorldQuat.clone().multiply(restData.localQuat);

  const newWorldQuat = delta.multiply(currentRestWorldQuat);

  // Convert back to local space
  return parentWorldQuat.clone().invert().multiply(newWorldQuat);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Slerp a bone's current quaternion toward a target. */
export function slerpBone(
  bone: THREE.Bone,
  smoothed: THREE.Quaternion,
  target: THREE.Quaternion,
  alpha: number
): void {
  smoothed.slerp(target, alpha);
  bone.quaternion.copy(smoothed);
}
