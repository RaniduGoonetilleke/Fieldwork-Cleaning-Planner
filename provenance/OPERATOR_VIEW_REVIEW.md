# Operator-view evidence and behaviour review

6 November 2026. Bounded review of `public/team.js`, `public/index.html`, `public/team.css`, `planner_service.py`, relevant unchanged planner branches, model credits and `verification/team_checks/API_EXAMPLES.json`. No implementation edits and no browser use. Visual and browser checks were in progress separately when this review was recorded.

## Verdict

No material error found in the case descriptions, commercial-context limits, human-role rules, choice/confirmation handling or no-dispatch claims. The operator view makes the existing planning logic easier to inspect without adding a transfer policy, measured fatigue, cleaning-performance result or connected team. One small pending-state inconsistency should be corrected.

## Small correction

**Old person/booking status remains visible while new inputs are being evaluated.** `public/team.js:23–35` checks `state.pending` only when there is no previous `state.data`. `setPending` at lines 37–42 disables task actions and sets the 3D members to “Updating…”, but does not update the roster, selected-member status or booking grid. Consequently a user who changes H1 to Busy can temporarily see that new input beside an old “Free” or “Booked in plan” status during a slow response. The plan heading says updating and task cards dim, but these other current-looking statuses do not.

Suggested correction: make pending status take precedence in `memberStatus`, then refresh or visibly mark the roster, member status and bookings when pending begins and ends. Keep the chosen input values usable so fast edits still work. The existing request counter already prevents an older response from replacing a newer one; no selector change is needed.

## Evidence checks

- UR3 is described as registered-cube handover with human command/confirmation in its studied physical setup. No fatigue sensing or general cleaning capability is invented.
- UR5 is described as detection of a taped whiteboard region with an attendant who starts and watches. The distinction from qualified force-controlled wiping is explicit. No disputed 99.5% accuracy or new dataset claim appears in the operator view.
- G1 is explicitly a pelvis-supported simulation case at 7 N and 8 N. The new-building warning excludes physical G1 deployment. People and robots shown together are expressly a planning exercise, not an integrated executed workplace.
- H1/H2 training and roles match the authored scenario. Availability changes do not grant H2 operator, attendant or confirmer qualifications. “Booked in plan” describes a reservation; pending confirmation is identified separately.
- Manual glass wiping remains an explicitly allowed alternative and is not presented as satisfying the original force-controlled request. Area failure blocks both robot and manual assignments.
- The scenario's logical slots are presented as rounds without measured durations. The app does not claim scheduling optimisation or move blocked work automatically to a later slot.
- Browser confirmations are labelled demonstration inputs. The backend validates the complete browser context and passes the original job and selector bindings into the unchanged planner. It neither authenticates H1 nor sends a robot command.
- The imported-model note identifies them as visual aids, not experiment assets. G1 credits additionally disclose the vendor 29-DOF display variant, difference from the studied five-finger Isaac asset, and schematic stand. Human credits identify display figures, not actual participants. This review checked the accuracy/scope of those disclosures, not a new independent licensing audit.

## Independent direct API checks

Ran read-only service calls with bytecode disabled; no result or source files were modified:

1. With UR5 excluded, choosing G1 D at 8 N gives PENDING_CONFIRMATION. Using the returned confirmation template gives RECOMMENDED, retains 8 N and reserves H1.
2. Reusing that declaration after making H1 busy, marking the shared area unsafe, or removing G1 is rejected as out of date in each case.
3. H1 busy in both rounds leaves UR5 and UR3 WAITING_FOR_PERSON and reserves no person; H2 does not inherit the missing roles.
4. The customer-building example reserves no robot and offers the two declared manual alternatives under passing authored conditions.
5. Setting that customer's shared safety to FAIL leaves no robot or person reservation.

The stored API examples agree with these behaviours. No simulation, external contact, manuscript edit or milestone change was performed.

## Correction recheck

The pending-state finding is closed by read-only inspection of the updated code. `memberStatus` now returns “Updating…” before looking at old response data, and `setPending` refreshes the roster, selected-member panel and existing booking grid on both transitions. Task actions remain disabled while pending. The G1 card also now displays the returned `robot.setpoint_n` as an explicit setting, so a chosen 7 N or 8 N option is visible beside the reservation instead of being left implicit. The chip reads the backend result and does not invent an operating range. No remaining material finding in this bounded review; browser verification remained a separate outstanding check.
