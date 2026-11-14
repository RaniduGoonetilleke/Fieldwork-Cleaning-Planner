# Imported 3D display models

These models help readers identify and select team members. Their appearance, static poses and materials do not supply evidence to the decision rules. Availability labels come from the scenario inputs, not from a sensor or from what a figure appears to be doing.

## UR3 and UR5

Visual meshes from [Universal Robots ROS2 Description](https://github.com/UniversalRobots/Universal_Robots_ROS2_Description/tree/78c5afd8bfee78a459c0265304340a85f1d44792), under the [BSD-3-Clause licence](ur/LICENSE). All fourteen visual-mesh files match that source revision. The meshes were assembled in display poses using the robot descriptions and converted to GLB. No private UR5 controller code is included.

## G1

Visual meshes from [Unitree Robotics](https://github.com/unitreerobotics/unitree_ros/tree/41dec58c7a3ccb3050243ef16ac2ca74b2b0f9ca/robots/g1_description), copyright 2016–2022 HangZhou YuShu TECHNOLOGY CO., LTD. (Unitree Robotics), under the [BSD-3-Clause licence](g1/LICENSE). The 29-DOF vendor model was posed and converted to GLB. A schematic pelvis stand is added in the viewer. This display variant is not the exact five-finger Isaac asset behind the paper's evidence.

## Robot helper and glass cleaner

Clothed standing models from the [Background Posed Humans Pack by Quaternius](https://quaternius.com/packs/backgroundposedhumans.html), released under CC0. The standing bodies and hairstyles were combined, centred, scaled and converted to self-contained GLB files. Original colours were retained with matte materials. They illustrate roles and do not depict participants. The full source record and the upstream licence-file heading discrepancy are explained in [people/CREDITS.md](people/CREDITS.md).

The five active GLBs total approximately 15.4 MB. All are served locally. Original robot source hashes are in `provenance/MODEL_SOURCES.json`; current people sources and conversion checks are in `provenance/HUMAN_MODELS_UPDATE.json`. The earlier Cesium asset and its licence remain on disk as unused historical assets.

The gallery normalizes display heights for legibility; relative model sizes are not to scale. This scaling does not alter any planning input or recorded measurement.
