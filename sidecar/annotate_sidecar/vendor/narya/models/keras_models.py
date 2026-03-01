# Vendored from narya (MIT License, Copyright (c) 2020 Paul Garnier)
from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import logging
import numpy as np
import tensorflow as tf
import segmentation_models as sm
from .keras_layers import pyramid_layer
from ..preprocessing.image import _build_homo_preprocessing
from ..preprocessing.image import _build_keypoint_preprocessing

logger = logging.getLogger("annotate_sidecar.vendor.narya")

RESNET_ARCHI_TF_KERAS_PATH = (
    "https://storage.googleapis.com/narya-bucket-1/models/deep_homo_model_1.h5"
)
RESNET_ARCHI_TF_KERAS_NAME = "deep_homo_model_1.h5"
RESNET_ARCHI_TF_KERAS_TOTAR = False


def _build_resnet18():
    resnet18_path_to_file = tf.keras.utils.get_file(
        RESNET_ARCHI_TF_KERAS_NAME,
        RESNET_ARCHI_TF_KERAS_PATH,
        RESNET_ARCHI_TF_KERAS_TOTAR,
    )

    try:
        resnet18 = tf.keras.models.load_model(resnet18_path_to_file, compile=False)
        resnet18.compile()
        inputs = resnet18.input
        outputs = resnet18.layers[-2].output
        return tf.keras.models.Model(inputs=inputs, outputs=outputs, name="custom_resnet18")
    except Exception as e:
        logger.warning(
            "Could not load ResNet18 .h5 model (likely Python bytecode version "
            "mismatch with Lambda layers): %s. DeepHomoModel will be unavailable; "
            "keypoint-based homography will still work.", e
        )
        return None


class DeepHomoModel:
    def __init__(self, pretrained=False, input_shape=(256, 256)):
        self.input_shape = input_shape
        self.pretrained = pretrained
        self._available = False

        self.resnet_18 = _build_resnet18()
        if self.resnet_18 is None:
            logger.warning("DeepHomoModel unavailable (ResNet18 failed to load)")
            self.model = None
            self.preprocessing = None
            return

        inputs = tf.keras.layers.Input((self.input_shape[0], self.input_shape[1], 3))
        x = self.resnet_18(inputs)
        outputs = pyramid_layer(x, 2)

        self.model = tf.keras.models.Model(
            inputs=[inputs], outputs=outputs, name="DeepHomoPyramidalFull"
        )

        self.preprocessing = _build_homo_preprocessing(input_shape)
        self._available = True

    @property
    def available(self):
        return self._available

    def __call__(self, input_img):
        if not self._available:
            return None
        img = self.preprocessing(input_img)
        corners = self.model.predict(np.array([img]))
        return corners

    def load_weights(self, weights_path):
        if not self._available:
            return
        try:
            self.model.load_weights(weights_path)
            print("Succesfully loaded weights from {}".format(weights_path))
        except:
            orig_weights = "Randomly"
            print(
                "Could not load weights from {}, weights will be loaded {}".format(
                    weights_path, orig_weights
                )
            )


class KeypointDetectorModel:
    def __init__(
        self,
        backbone="efficientnetb3",
        model_choice="FPN",
        num_classes=29,
        input_shape=(320, 320),
    ):
        self.input_shape = input_shape
        self.classes = [str(i) for i in range(num_classes)] + ["background"]
        self.backbone = backbone

        n_classes = len(self.classes)
        activation = "softmax"

        if model_choice == "FPN":
            # encoder_weights=None: narya loads its own pretrained weights
            # via load_weights(), so we skip the ImageNet download
            # (which has broken URLs in the efficientnet package)
            self.model = sm.FPN(
                self.backbone,
                classes=n_classes,
                activation=activation,
                input_shape=(input_shape[0], input_shape[1], 3),
                encoder_weights=None,
            )
        else:
            self.model = None
            print("{} is not used yet".format(model_choice))

        self.preprocessing = _build_keypoint_preprocessing(input_shape, backbone)

    def __call__(self, input_img):
        img = self.preprocessing(input_img)
        pr_mask = self.model.predict(np.array([img]))
        return pr_mask

    def load_weights(self, weights_path):
        try:
            self.model.load_weights(weights_path)
            print("Succesfully loaded weights from {}".format(weights_path))
        except:
            orig_weights = "from Imagenet"
            print(
                "Could not load weights from {}, weights will be loaded {}".format(
                    weights_path, orig_weights
                )
            )
