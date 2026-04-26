import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bbgeRouter from "./bbge/index";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/bbge", bbgeRouter);

export default router;
