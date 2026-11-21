# Train with Keras on JAX, serve with ONNX Runtime only

Models are trained with Keras 3 on the JAX backend. This is the backend used in KerasHub's official detection guide, and the newest maintained route to ONNX export is jax2onnx.

The API loads exported `.onnx` files with ONNX Runtime and never imports Keras. That keeps the serving image small and lets the model run on CPU or edge hardware.

Two consequences:
- **Decoding moves into the API.** The exported ONNX graph contains only the model's raw outputs. The API, written in numpy, has to turn those into final smoke boxes and drop overlapping duplicates.
- **Every export must pass a parity check.** The ONNX model's output is compared with the Keras model's on the same images before the export is used.
