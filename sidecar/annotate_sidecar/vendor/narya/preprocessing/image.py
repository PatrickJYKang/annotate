# Vendored from narya (MIT License, Copyright (c) 2020 Paul Garnier)
from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import numpy as np
import cv2
import segmentation_models as sm
from ..utils.image import (
    np_img_to_torch_img,
    normalize_single_image_torch,
    torch_img_to_np_img,
)


def _build_keypoint_preprocessing(input_shape, backbone):
    sm_preprocessing = sm.get_preprocessing(backbone)

    def preprocessing(input_img, **kwargs):
        to_normalize = False if np.percentile(input_img, 98) > 1.0 else True

        if len(input_img.shape) == 4:
            image = input_img[0] * 255.0 if to_normalize else input_img[0] * 1.0
        else:
            image = input_img * 255.0 if to_normalize else input_img * 1.0

        image = cv2.resize(image, input_shape)
        image = sm_preprocessing(image)
        return image

    return preprocessing


def _build_homo_preprocessing(input_shape):
    def preprocessing(input_img, **kwargs):
        if len(input_img.shape) == 4:
            image = input_img[0]
        else:
            image = input_img

        image = cv2.resize(image, input_shape)
        image = torch_img_to_np_img(
            normalize_single_image_torch(np_img_to_torch_img(image))
        )
        return image

    return preprocessing
