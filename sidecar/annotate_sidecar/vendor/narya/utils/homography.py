# Vendored from narya (MIT License, Copyright (c) 2020 Paul Garnier)
from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import numpy as np
import kornia
import torch
import cv2

from .utils import hasnan, isnan, to_numpy, to_torch
from .image import torch_img_to_np_img, np_img_to_torch_img


def normalize_homo(h, **kwargs):
    return h / h[2, 2]


def get_perspective_transform_torch(src, dst):
    src = src.contiguous()
    dst = dst.contiguous()
    if hasattr(kornia, "get_perspective_transform"):
        return kornia.get_perspective_transform(src, dst)
    return kornia.geometry.transform.get_perspective_transform(src, dst)


def get_perspective_transform_cv(src, dst):
    if len(src.shape) == 2:
        M, _ = cv2.findHomography(src, dst, cv2.RANSAC, 5)
    else:
        M = []
        for src_, dst_ in zip(src, dst):
            M.append(cv2.findHomography(src_, dst_, cv2.RANSAC, 5)[0])
        M = np.array(M)
    return M


def get_perspective_transform(src, dst, method="cv"):
    return (
        get_perspective_transform_cv(src, dst)
        if method == "cv"
        else get_perspective_transform_torch(src, dst)
    )


def warp_image(img, H, out_shape=None, method="cv"):
    return (
        warp_image_cv(img, H, out_shape=out_shape)
        if method == "cv"
        else warp_image_torch(img, H, out_shape=out_shape)
    )


def warp_image_torch(img, H, out_shape=None):
    if out_shape is None:
        out_shape = img.shape[-2:]
    if len(img.shape) < 4:
        img = img[None]
    if len(H.shape) < 3:
        H = H[None]
    if img.shape[0] != H.shape[0]:
        raise ValueError(
            "batch size of images ({}) do not match the batch size of homographies ({})".format(
                img.shape[0], H.shape[0]
            )
        )
    batchsize = img.shape[0]

    y, x = torch.meshgrid(
        [
            torch.linspace(-0.5, 0.5, steps=out_shape[-2]),
            torch.linspace(-0.5, 0.5, steps=out_shape[-1]),
        ]
    )
    x = x.to(img.device)
    y = y.to(img.device)
    x, y = x.flatten(), y.flatten()

    xy = torch.stack([x, y, torch.ones_like(x)])
    xy = xy.repeat([batchsize, 1, 1])
    xy_warped = torch.matmul(H, xy)
    xy_warped, z_warped = xy_warped.split(2, dim=1)

    xy_warped = 2.0 * xy_warped / (z_warped + 1e-8)
    x_warped, y_warped = torch.unbind(xy_warped, dim=1)
    grid = torch.stack(
        [
            x_warped.view(batchsize, *out_shape[-2:]),
            y_warped.view(batchsize, *out_shape[-2:]),
        ],
        dim=-1,
    )

    warped_img = torch.nn.functional.grid_sample(
        img, grid, mode="bilinear", padding_mode="zeros"
    )

    if hasnan(warped_img):
        print("nan value in warped image! set to zeros")
        warped_img[isnan(warped_img)] = 0

    return warped_img


def warp_image_cv(img, H, out_shape=None):
    if out_shape is None:
        out_shape = img.shape[-3:-1] if len(img.shape) == 4 else img.shape[:-1]
    if len(img.shape) == 3:
        return cv2.warpPerspective(img, H, dsize=out_shape)
    else:
        if img.shape[0] != H.shape[0]:
            raise ValueError(
                "batch size of images ({}) do not match the batch size of homographies ({})".format(
                    img.shape[0], H.shape[0]
                )
            )
        out_img = []
        for img_, H_ in zip(img, H):
            out_img.append(cv2.warpPerspective(img_, H_, dsize=out_shape))
        return np.array(out_img)


def warp_point(pts, homography, method="cv"):
    return (
        warp_point_cv(pts, homography)
        if method == "cv"
        else warp_point_torch(pts, homography)
    )


def warp_point_cv(pts, homography):
    dst = cv2.perspectiveTransform(np.array(pts).reshape(-1, 1, 2), homography)
    return dst[0][0]


def warp_point_torch(pts, homography, input_shape=(320, 320, 3)):
    img_test = np.zeros(input_shape)
    dir_ = [0, -1, 1, -2, 2, 3, -3]
    for dir_x in dir_:
        for dir_y in dir_:
            to_add_x = min(max(0, pts[0] + dir_x), input_shape[0] - 1)
            to_add_y = min(max(0, pts[1] + dir_y), input_shape[1] - 1)
            for i in range(3):
                img_test[to_add_y, to_add_x, i] = 1.0

    pred_warp = warp_image(
        np_img_to_torch_img(img_test), to_torch(homography), method="torch"
    )
    pred_warp = torch_img_to_np_img(pred_warp[0])
    indx = np.argwhere(pred_warp[:, :, 0] > 0.8)
    x, y = indx[:, 0].mean(), indx[:, 1].mean()
    dst = np.array([y, x])
    return dst


def get_default_corners(batch_size):
    orig_corners = np.array(
        [[-0.5, 0.1], [-0.5, 0.5], [0.5, 0.5], [0.5, 0.1]], dtype=np.float32
    )
    orig_corners = np.tile(orig_corners, (batch_size, 1, 1))
    return orig_corners


def get_corners_from_nn(batch_corners_pred):
    batch_size = batch_corners_pred.shape[0]
    corners = np.reshape(batch_corners_pred, (-1, 2, 4))
    corners = np.transpose(corners, axes=(0, 2, 1))
    corners = np.reshape(corners, (batch_size, 4, 2))
    return corners


def compute_homography(batch_corners_pred):
    batch_size = batch_corners_pred.shape[0]
    corners = get_corners_from_nn(batch_corners_pred)
    orig_corners = get_default_corners(batch_size)
    homography = get_perspective_transform_torch(
        to_torch(orig_corners), to_torch(corners)
    )
    return to_numpy(homography)
