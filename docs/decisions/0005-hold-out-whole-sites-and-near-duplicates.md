# Hold out whole sites for testing, and remove near-duplicates across splits

The test set is every frame from about 15% of sites, chosen per partner. It is not a random sample of frames, and not even a sample of camera ids.

Frames are 30–60 seconds apart, and cameras at one site share background. So a random split, or a split by camera id, lets near-identical frames land in both train and test. That inflates scores: on FIgLib it reached 0.91 accuracy, against 0.83 when fire events were properly separated.

We also remove any training frame whose perceptual hash is within 6 bits of a validation or test frame.

This costs some training data on purpose. The splits are frozen in `splits_v1.json` together with their hashes.
