# Imported 3D display models

These models help readers identify and select team members. Their appearance, static poses and materials do not supply evidence to the decision rules. Availability labels come from the scenario inputs, not from a sensor or from what a figure appears to be doing.

## UR3 and UR5

Visual meshes from [Universal Robots ROS2 Description](https://github.com/UniversalRobots/Universal_Robots_ROS2_Description/tree/78c5afd8bfee78a459c0265304340a85f1d44792), under the [BSD-3-Clause licence](../public/models/ur/LICENSE). All fourteen visual-mesh files match that source revision. The meshes were assembled in display poses using the robot descriptions and converted to GLB. No private UR5 controller code is included.

## G1

Visual meshes from [Unitree Robotics](https://github.com/unitreerobotics/unitree_ros/tree/41dec58c7a3ccb3050243ef16ac2ca74b2b0f9ca/robots/g1_description), copyright 2016–2022 HangZhou YuShu TECHNOLOGY CO., LTD. (Unitree Robotics), under the [BSD-3-Clause licence](../public/models/g1/LICENSE). The 29-DOF vendor model was posed and converted to GLB. A schematic pelvis stand is added in the viewer. This display variant is not the exact five-finger Isaac asset behind the paper's evidence.

## People H1 and H2

“[Cesium Man](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/8f492390ddc7a2ae221a1369ef560589cf8c70fb/Models/CesiumMan)” by Cesium, copyright 2017, used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The viewer uses two instances with plain, recolored materials, a frozen pose and adjusted display height. They represent authored roles, not actual participants. The branded texture is not displayed. [Original licence notice](../public/models/human/LICENSE.md) and [trademark notice](../public/models/human/TRADEMARK.txt) are included; no endorsement is implied.

The four GLB assets total approximately 15.6 MB. They are served locally with the application. Full source hashes and conversion checks are in `provenance/MODEL_SOURCES.json` and the accompanying records.

The gallery normalizes display heights for legibility; relative model sizes are not to scale. This scaling does not alter any planning input or recorded measurement.
