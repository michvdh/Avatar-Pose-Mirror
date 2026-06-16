import { Router, type IRouter } from "express";
import healthRouter from "./health";
import gcsRouter from "./gcs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(gcsRouter);

export default router;
