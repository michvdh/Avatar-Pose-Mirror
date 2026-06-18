---
name: Therapist Suzie FBX asset
description: The Therapist_Suzie.fbx file is a large binary (45MB) not committed to git — it must be manually copied to public/ whenever the branch is fresh.
---

The file `artifacts/avatar-pose-mirror/public/Therapist_Suzie.fbx` (45 MB) is a binary asset that is NOT committed to git (likely in .gitignore or was never staged). It gets lost on branch switches or fresh clones.

**Rule:** Before working on TherapistScene, check `ls artifacts/avatar-pose-mirror/public/Therapist_Suzie.fbx`. If missing, ask the user to re-upload it. The user will send it as an attachment which lands in `attached_assets/`; copy it with `cp attached_assets/<filename>.fbx artifacts/avatar-pose-mirror/public/Therapist_Suzie.fbx`.

**Why:** TherapistScene loads it via FBXLoader from `/Therapist_Suzie.fbx`. A 404 fails silently behind the loading overlay, causing `suzieReady` to stay false forever (the loading screen never disappears).

**How to apply:** At the start of any session touching TherapistScene or the session loading flow, verify the file exists in public/.
