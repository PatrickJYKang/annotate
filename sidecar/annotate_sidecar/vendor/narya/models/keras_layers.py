# Vendored from narya (MIT License, Copyright (c) 2020 Paul Garnier)
from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import tensorflow as tf


def pyramid_layer(
    x, indx, activation="tanh", output_size=8, nb_neurons=[512, 512, 256, 128]
):
    dense_name_base = "full_" + str(indx)
    for indx, neuron in enumerate(nb_neurons):
        x = tf.keras.layers.Dense(
            neuron, name=dense_name_base + str(neuron) + "_" + str(indx)
        )(x)
    x = tf.keras.layers.Dense(output_size, name=dense_name_base + "output")(x)
    output = tf.keras.layers.Activation(activation)(x)
    return output
