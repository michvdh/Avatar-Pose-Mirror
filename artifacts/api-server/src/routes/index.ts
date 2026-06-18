import { Router, type IRouter } from "express";
import healthRouter from "./health";
import exercisesRouter from "./exercises";

const router: IRouter = Router();

router.use(healthRouter);
router.use(exercisesRouter);

export default router;
