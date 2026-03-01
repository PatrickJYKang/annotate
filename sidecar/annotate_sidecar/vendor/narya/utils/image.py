# Vendored from narya (MIT License, Copyright (c) 2020 Paul Garnier)
from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import torch
import numpy as np

from torchvision.transforms import Normalize

from .utils import to_numpy, to_torch


def torch_img_to_np_img(torch_img):
    if isinstance(torch_img, np.ndarray):
        return torch_img
    assert isinstance(torch_img, torch.Tensor), "cannot process data type: {0}".format(
        type(torch_img)
    )
    if len(torch_img.shape) == 4 and (
        torch_img.shape[1] == 3 or torch_img.shape[1] == 1
    ):
        return np.transpose(torch_img.detach().cpu().numpy(), (0, 2, 3, 1))
    if len(torch_img.shape) == 3 and (
        torch_img.shape[0] == 3 or torch_img.shape[0] == 1
    ):
        return np.transpose(torch_img.detach().cpu().numpy(), (1, 2, 0))
    elif len(torch_img.shape) == 2:
        return torch_img.detach().cpu().numpy()
    else:
        raise ValueError("cannot process this image")


def np_img_to_torch_img(np_img):
    if isinstance(np_img, torch.Tensor):
        return np_img
    assert isinstance(np_img, np.ndarray), "cannot process data type: {0}".format(
        type(np_img)
    )
    if len(np_img.shape) == 4 and (np_img.shape[3] == 3 or np_img.shape[3] == 1):
        return to_torch(np.transpose(np_img, (0, 3, 1, 2)))
    if len(np_img.shape) == 3 and (np_img.shape[2] == 3 or np_img.shape[2] == 1):
        return to_torch(np.transpose(np_img, (2, 0, 1)))
    elif len(np_img.shape) == 2:
        return to_torch(np_img)
    else:
        raise ValueError("cannot process this image")


def normalize_single_image_torch(image, img_mean=None, img_std=None):
    if len(image.shape) != 3:
        raise ValueError(
            "The len(shape) of the image is {}, not 3".format(len(image.shape))
        )
    if isinstance(image, torch.Tensor) == False:
        raise ValueError("The image is not a torch Tensor")
    if img_mean is None and img_std is None:
        img_mean = torch.mean(image, dim=(1, 2)).view(-1, 1, 1)
        img_std = image.contiguous().view(image.size(0), -1).std(-1).view(-1, 1, 1)
        image = (image - img_mean) / img_std
    else:
        image = Normalize(img_mean, img_std, inplace=False)(image)
    return image
