"""
Person segmentation service — YOLO + MobileSAM.

Pipeline:
  1. Run YOLO on frame → person bounding boxes
  2. For each person bbox → prompt MobileSAM with box coordinates
  3. Merge all per-person masks into a single alpha mask (union via np.maximum)
  4. Return alpha mask (0 = background, 255 = foreground)
"""

import logging
from typing import List, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger("annotate_sidecar.segmenter")


class Segmenter:
    """YOLO detect people → box-prompt MobileSAM → merge masks."""

    def __init__(self, yolo_model_name: str = "yolov8n.pt"):
        self._yolo = None
        self._yolo_model_name = yolo_model_name
        self._sam_predictor = None
        self._sam_available: Optional[bool] = None

    @property
    def sam_available(self) -> bool:
        """Check if MobileSAM / SAM is importable."""
        if self._sam_available is None:
            try:
                import mobile_sam  # noqa: F401
                self._sam_available = True
            except ImportError:
                try:
                    import segment_anything  # noqa: F401
                    self._sam_available = True
                except ImportError:
                    self._sam_available = False
        return self._sam_available

    def _load_yolo(self):
        """Lazy-load YOLO model."""
        if self._yolo is not None:
            return
        from ultralytics import YOLO
        logger.info("Loading YOLO model: %s", self._yolo_model_name)
        self._yolo = YOLO(self._yolo_model_name)
        logger.info("YOLO model loaded")

    def _load_sam(self):
        """Lazy-load MobileSAM predictor."""
        if self._sam_predictor is not None:
            return
        if not self.sam_available:
            raise RuntimeError(
                "MobileSAM or segment-anything is required for segmentation. "
                "Install with: pip install git+https://github.com/ChaoningZhang/MobileSAM.git"
            )

        try:
            from mobile_sam import sam_model_registry, SamPredictor
            sam_type = "vit_t"
        except ImportError:
            from segment_anything import sam_model_registry, SamPredictor
            sam_type = "vit_h"  # fallback to full SAM

        import torch

        # Auto-download weights
        import urllib.request
        import os
        weights_dir = os.path.join(os.path.expanduser("~"), ".cache", "annotate-sidecar")
        os.makedirs(weights_dir, exist_ok=True)

        if sam_type == "vit_t":
            weights_url = "https://github.com/ChaoningZhang/MobileSAM/raw/master/weights/mobile_sam.pt"
            weights_path = os.path.join(weights_dir, "mobile_sam.pt")
        else:
            weights_url = "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth"
            weights_path = os.path.join(weights_dir, "sam_vit_h_4b8939.pth")

        if not os.path.exists(weights_path):
            logger.info("Downloading SAM weights from %s ...", weights_url)
            urllib.request.urlretrieve(weights_url, weights_path)
            logger.info("SAM weights saved to %s", weights_path)

        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info("Loading SAM model (type=%s, device=%s)...", sam_type, device)
        sam = sam_model_registry[sam_type](checkpoint=weights_path)
        sam.to(device=device)
        self._sam_predictor = SamPredictor(sam)
        logger.info("SAM predictor ready")

    def _detect_people(
        self,
        frame: np.ndarray,
        conf_threshold: float = 0.3,
    ) -> List[np.ndarray]:
        """
        Run YOLO on a frame and return person bounding boxes.

        Returns:
            List of [x1, y1, x2, y2] arrays in pixel coordinates.
        """
        self._load_yolo()
        results = self._yolo(frame, verbose=False, conf=conf_threshold, classes=[0])
        bboxes: List[np.ndarray] = []
        for r in results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                xyxy = box.xyxy[0].cpu().numpy()
                bboxes.append(xyxy)  # [x1, y1, x2, y2]
        return bboxes

    def segment_frame(
        self,
        frame: np.ndarray,
        prompt_bboxes: Optional[List[np.ndarray]] = None,
        conf_threshold: float = 0.3,
    ) -> np.ndarray:
        """
        Segment people in a frame.

        Args:
            frame: BGR numpy array (H, W, 3).
            prompt_bboxes: Optional pre-computed bounding boxes [x1,y1,x2,y2].
                           If None, runs YOLO detection first.
            conf_threshold: YOLO confidence threshold.

        Returns:
            Alpha mask (H, W) uint8, 0=background, 255=foreground.
        """
        h, w = frame.shape[:2]

        # Step 1: detect people if no bboxes provided
        if prompt_bboxes is None:
            prompt_bboxes = self._detect_people(frame, conf_threshold)

        if len(prompt_bboxes) == 0:
            logger.info("No people detected — returning empty mask")
            return np.zeros((h, w), dtype=np.uint8)

        # Step 2: run SAM with box prompts
        self._load_sam()

        # SAM expects RGB
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        self._sam_predictor.set_image(rgb)

        # Step 3: merge masks
        merged = np.zeros((h, w), dtype=np.uint8)

        for bbox in prompt_bboxes:
            input_box = np.array(bbox).reshape(1, 4)
            masks, scores, _ = self._sam_predictor.predict(
                point_coords=None,
                point_labels=None,
                box=input_box,
                multimask_output=True,
            )
            # Pick the mask with the highest score
            best_idx = int(np.argmax(scores))
            mask = masks[best_idx]  # bool array (H, W)
            merged = np.maximum(merged, (mask * 255).astype(np.uint8))

        logger.info(
            "Segmented %d people, foreground ratio: %.3f",
            len(prompt_bboxes),
            np.count_nonzero(merged) / (h * w),
        )
        return merged
