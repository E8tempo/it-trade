import type { ComponentType } from "react";

import ImagePipeline from "./image-pipeline";
import Pricing from "./pricing";
import Sync from "./sync";
import WatermarkCalibration from "./watermark-calibration";
import WatermarkDetection from "./watermark-detection";
import WatermarkModel from "./watermark-model";
import WatermarkRemoval from "./watermark-removal";

export const DOC_CONTENT: Record<string, ComponentType> = {
  "watermark-model": WatermarkModel,
  "watermark-detection": WatermarkDetection,
  "watermark-removal": WatermarkRemoval,
  "watermark-calibration": WatermarkCalibration,
  "image-pipeline": ImagePipeline,
  pricing: Pricing,
  sync: Sync,
};
