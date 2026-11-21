# EmberWatch

Spots wildfire smoke in images from fixed tower cameras soon after a fire starts, and puts what it finds in front of a human operator.

## Where images come from

**Site**:
A physical location, such as a mountaintop or tower, where one or more cameras are mounted.
_Avoid_: station, tower

**Camera**:
One fixed imager at a site, pointing in one viewing direction.
_Avoid_: feed, stream, imager

**Frame**:
One image captured by one camera at one moment.
_Avoid_: snapshot, picture

## Fires

**Fire event**:
One real-world fire, which may be seen by several cameras at several sites.
_Avoid_: fire (alone), incident

**Sequence**:
The consecutive frames from one camera that cover the time around one fire event.
_Avoid_: clip, video

**Onset**:
The first frame of a sequence in which a person can see smoke. The fire itself started earlier, at a moment nobody observed.
_Avoid_: ignition, start

## What the system produces

**Smoke box**:
A rectangle in a frame that encloses visible smoke, whether drawn by a person or predicted by a model.
_Avoid_: bounding box (alone), label

**Detection**:
The model's claim that one frame contains smoke in a given smoke box, with a confidence score.
_Avoid_: prediction, hit

**Plume track**:
Detections from consecutive frames of one camera that are judged to be the same smoke.
_Avoid_: tube, trajectory

**Confirmation**:
The verdict, made over a plume track, that the smoke is real and growing rather than cloud, fog or haze.
_Avoid_: verification, validation

**Alert**:
A confirmed plume track raised to an operator for a decision.
_Avoid_: alarm, notification, event

**Bearing**:
The compass direction from a camera to a plume.
_Avoid_: angle, heading

**Location estimate**:
Where a plume probably is on the map, found where bearings from cameras at two or more sites cross.
_Avoid_: triangulation, fix

## People and judgments

**Operator**:
The person who watches alerts and decides what each one is.
_Avoid_: user, analyst

**Review**:
An operator's verdict on one alert: either confirmed fire or false alarm.
_Avoid_: feedback, label

**False alarm**:
An alert that the operator rejected, or one known to have no fire behind it.
_Avoid_: false positive (in operator-facing language)

**Hard negative**:
A frame with no smoke that looks enough like smoke to fool the model, such as low cloud, fog, dust or sun glare.

## How success is measured

**Time to detect**:
The minutes from onset to the first alert for that fire event.
_Avoid_: latency, detection delay

**False alarms per camera-day**:
How many false alarms one camera produces in 24 hours of watching.

**Held-out site**:
A site whose frames are never used in training, kept back to test how well the model works on views it has never seen.
_Avoid_: unseen camera, test camera

**Replay**:
Feeding frames from the past through the system as if they were arriving now.
_Avoid_: simulation, playback
