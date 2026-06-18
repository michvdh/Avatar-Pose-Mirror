import { Router, type IRouter } from "express";
import { Storage } from "@google-cloud/storage";

const router: IRouter = Router();

const BUCKET = process.env.GCS_BUCKET;

function toExerciseName(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

router.get("/exercises", async (_req, res) => {
  if (!BUCKET) {
    res.json([]);
    return;
  }

  try {
    const storage = new Storage();
    const [files] = await storage.bucket(BUCKET).getFiles();
    const exercises = files
      .filter((f) => /\.(mp4|webm|mov)$/i.test(f.name))
      .map((f) => {
        const parts = f.name.split("/");
        const filename = parts[parts.length - 1];
        return {
          name: filename,
          exerciseName: toExerciseName(filename),
          objectPath: f.name,
        };
      });
    res.json(exercises);
  } catch (err) {
    res.status(500).json({ error: "Failed to list exercises" });
  }
});

router.get("/exercises/video", async (req, res) => {
  const objectPath = req.query.object as string | undefined;
  if (!objectPath) {
    res.status(400).json({ error: "Missing object query parameter" });
    return;
  }

  if (!BUCKET) {
    res.status(503).json({ error: "GCS_BUCKET not configured" });
    return;
  }

  try {
    const storage = new Storage();
    const file = storage.bucket(BUCKET).file(objectPath);
    const [metadata] = await file.getMetadata();
    const contentType = (metadata.contentType as string | undefined) ?? "video/mp4";
    const totalSize = Number(metadata.size);

    const range = req.headers.range;
    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : Math.min(start + 1024 * 1024, totalSize - 1);
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${totalSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
      });
      file.createReadStream({ start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": totalSize,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
      });
      file.createReadStream().pipe(res);
    }
  } catch (err) {
    res.status(404).json({ error: "Video not found" });
  }
});

export default router;
