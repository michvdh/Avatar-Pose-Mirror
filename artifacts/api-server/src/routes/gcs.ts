import { Router, type IRouter } from "express";
import { Storage } from "@google-cloud/storage";

const router: IRouter = Router();

function getStorage(): Storage {
  const key = process.env["GCP_KEY"];
  if (!key) throw new Error("GCP_KEY environment variable is not set");
  const credentials = JSON.parse(key);
  return new Storage({ credentials, projectId: credentials.project_id });
}

function getBucketName(): string {
  const bucket = process.env["GCS_BUCKET"];
  if (!bucket) throw new Error("GCS_BUCKET environment variable is not set");
  // Strip accidental gs:// prefix and surrounding whitespace
  return bucket.trim().replace(/^gs:\/\//, "").replace(/\/$/, "");
}

router.get("/exercises", async (_req, res) => {
  try {
    const storage = getStorage();
    const bucketName = getBucketName();
    const bucket = storage.bucket(bucketName);

    const [files] = await bucket.getFiles();

    const exercises = files
      .filter((f) => {
        const meta = f.metadata?.metadata as Record<string, string> | undefined;
        return meta?.["Exercise-Name"];
      })
      .map((f) => {
        const meta = f.metadata.metadata as Record<string, string>;
        return {
          name: f.name,
          exerciseName: meta["Exercise-Name"],
          objectPath: f.name,
        };
      });

    res.json(exercises);
  } catch (err: unknown) {
    const bucketName = process.env["GCS_BUCKET"]?.trim().replace(/^gs:\/\//, "").replace(/\/$/, "") ?? "(unset)";
    console.error("[GCS /exercises] bucket=%s error=%s", bucketName, err instanceof Error ? err.stack : String(err));
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message, bucket: bucketName });
  }
});

router.get("/exercises/video", async (req, res) => {
  try {
    const objectPath = req.query["object"] as string | undefined;
    if (!objectPath) {
      res.status(400).json({ error: "object query param is required" });
      return;
    }

    const storage = getStorage();
    const bucketName = getBucketName();
    const file = storage.bucket(bucketName).file(objectPath);

    const [metadata] = await file.getMetadata();
    const contentType = (metadata.contentType as string | undefined) ?? "video/mp4";
    const totalSize = Number(metadata.size ?? 0);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const rangeHeader = req.headers["range"];
    if (rangeHeader && totalSize > 0) {
      const [startStr, endStr] = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : totalSize - 1;
      const chunkSize = end - start + 1;

      res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
      res.setHeader("Content-Length", String(chunkSize));
      res.status(206);

      file.createReadStream({ start, end }).pipe(res);
    } else {
      if (totalSize > 0) res.setHeader("Content-Length", String(totalSize));
      file.createReadStream().pipe(res);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
