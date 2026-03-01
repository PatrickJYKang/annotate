# Vendored from narya (MIT License, Copyright (c) 2020 Paul Garnier)
from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import torch


def isnan(x):
    return x != x


def hasnan(x):
    return isnan(x).any()


def to_numpy(var):
    try:
        return var.numpy()
    except:
        return var.detach().numpy()


def to_torch(np_array):
    tensor = torch.from_numpy(np_array).float()
    return torch.autograd.Variable(tensor, requires_grad=False)
