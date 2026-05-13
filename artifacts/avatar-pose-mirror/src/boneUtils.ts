import * as THREE from "three";

export function findBone(
  root: THREE.Object3D,
  keywordSets: string[][]
): THREE.Bone | null {
  for (const keywords of keywordSets) {
    let found: THREE.Bone | null = null;
    root.traverse((obj) => {
      if (found) return;
      if (obj instanceof THREE.Bone) {
        const nameLower = obj.name.toLowerCase();
        if (keywords.every((kw) => nameLower.includes(kw))) {
          found = obj;
        }
      }
    });
    if (found) return found;
  }
  return null;
}

export function aimBone(
  bone: THREE.Bone,
  child: THREE.Bone,
  restLocalQuat: THREE.Quaternion,
  targetWorldDir: THREE.Vector3
): void {
  bone.quaternion.copy(restLocalQuat);
  bone.updateMatrixWorld(true);
  child.updateMatrixWorld(true);

  const boneWorldPos = new THREE.Vector3();
  const childWorldPos = new THREE.Vector3();
  bone.getWorldPosition(boneWorldPos);
  child.getWorldPosition(childWorldPos);

  const restWorldDir = childWorldPos.clone().sub(boneWorldPos).normalize();
  if (restWorldDir.lengthSq() < 1e-10) return;

  const restWorldQuat = new THREE.Quaternion();
  bone.getWorldQuaternion(restWorldQuat);

  const delta = new THREE.Quaternion().setFromUnitVectors(
    restWorldDir,
    targetWorldDir
  );

  const newWorldQuat = delta.multiply(restWorldQuat);

  const parentWorldQuat = new THREE.Quaternion();
  if (bone.parent) {
    bone.parent.getWorldQuaternion(parentWorldQuat);
  }

  bone.quaternion.copy(
    parentWorldQuat.clone().invert().multiply(newWorldQuat)
  );
  bone.updateMatrixWorld(true);
}
