# Vendored from narya (MIT License, Copyright (c) 2020 Paul Garnier)
from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import six
import numpy as np

FLIP_MAPPER = {
    0: 13, 1: 14, 2: 15, 3: 16, 4: 17, 5: 18, 6: 19, 7: 20, 8: 21, 9: 22,
    10: 10, 11: 11, 12: 12,
    13: 0, 14: 1, 15: 2, 16: 3, 17: 4, 18: 5, 19: 6, 20: 7, 21: 8, 22: 9,
    23: 27, 24: 28, 25: 25, 26: 26, 27: 23, 28: 24,
}

INIT_HOMO_MAPPER = {
    0: [3, 3], 1: [3, 66], 2: [51, 65], 3: [3, 117], 4: [17, 117],
    5: [3, 203], 6: [17, 203], 7: [3, 255], 8: [51, 254], 9: [3, 317],
    10: [160, 3], 11: [160, 160], 12: [160, 317],
    13: [317, 3], 14: [317, 66], 15: [270, 66], 16: [317, 118], 17: [304, 118],
    18: [317, 203], 19: [304, 203], 20: [317, 255], 21: [271, 255], 22: [317, 317],
    23: [51, 128], 24: [51, 193], 25: [161, 118], 26: [161, 203],
    27: [270, 128], 28: [269, 192],
}


def _get_flip_mapper():
    return FLIP_MAPPER


def _get_init_homo_mapper():
    return INIT_HOMO_MAPPER


def _add_mask(mask, val, x, y):
    dir_x = [0, -1, 1]
    dir_y = [0, -1, 1]
    for d_x in dir_x:
        for d_y in dir_y:
            new_x = min(max(x + d_x, 0), mask.shape[0] - 1)
            new_y = min(max(y + d_y, 0), mask.shape[1] - 1)
            mask[new_x][new_y] = val


def _build_mask(keypoints, mask_shape=(320, 320), nb_of_mask=29):
    mask = np.ones((mask_shape)) * nb_of_mask
    for id_kp, v in six.iteritems(keypoints):
        _add_mask(mask, id_kp, v[0], v[1])
    return mask


def _get_keypoints_from_mask(mask, treshold=0.9):
    keypoints = {}
    indexes = np.argwhere(mask[:, :, :-1] > treshold)
    for indx in indexes:
        id_kp = indx[2]
        if id_kp in keypoints.keys():
            keypoints[id_kp][0].append(indx[0])
            keypoints[id_kp][1].append(indx[1])
        else:
            keypoints[id_kp] = [[indx[0]], [indx[1]]]

    for id_kp in keypoints.keys():
        mean_x = np.mean(np.array(keypoints[id_kp][0]))
        mean_y = np.mean(np.array(keypoints[id_kp][1]))
        keypoints[id_kp] = [mean_y, mean_x]
    return keypoints


def collinear(p0, p1, p2, epsilon=0.001):
    x1, y1 = p1[0] - p0[0], p1[1] - p0[1]
    x2, y2 = p2[0] - p0[0], p2[1] - p0[1]
    return abs(x1 * y2 - x2 * y1) < epsilon


def _points_from_mask(mask, treshold=0.9):
    list_ids = []
    src_pts, dst_pts = [], []
    available_keypoints = _get_keypoints_from_mask(mask, treshold)
    for id_kp, v in six.iteritems(available_keypoints):
        src_pts.append(v)
        dst_pts.append(INIT_HOMO_MAPPER[id_kp])
        list_ids.append(id_kp)
    src, dst = np.array(src_pts), np.array(dst_pts)

    test_colinear = False
    if len(src) == 4:
        if collinear(dst_pts[0], dst_pts[1], dst_pts[2]) or collinear(dst_pts[0], dst_pts[1], dst_pts[3]) or collinear(dst_pts[1], dst_pts[2], dst_pts[3]):
            test_colinear = True
    src = np.array([]) if test_colinear else src
    dst = np.array([]) if test_colinear else dst

    return src, dst
