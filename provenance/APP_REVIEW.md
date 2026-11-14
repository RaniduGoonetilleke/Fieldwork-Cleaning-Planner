# App implementation review

6 November 2026. Read-only review of `planner_service.py`, `server.py`, `public/index.html` and `public/app.js`. No implementation or original source file edited. A direct Python probe exercised force mapping and stale confirmation. Findings below describe the initial implementation inspected during development; later corrections are recorded below.

## Corrections

1. **Job force control describes a narrower scope than the backend changes.** The controls say “G1 minimum (N)” and “G1 maximum (N)”, while `plan_job` changes every task containing a force request. A customer-building request for 7.5 N changed GP1, GP2, WS1–3 and WB1-W–WB3-W, all physical tasks. There are no G1 simulation tasks in that scenario. Either label the control “Requested wiping force — all applicable tasks” with an explanation or constrain the operation to the stated G1 tasks. Renaming the control preserves the current deliberate whole-job perturbation.

2. **UR5 detail needs a current qualification next to its archived statements.** `openEvidence` displays the old qualifier “evaluation set not named; no held-out test” directly under the limits heading. The November audit established that a matched independent test has not been identified, not that none exists. Keep the source profile and raw export exact; add a visible note near the UR5 qualifier list that these are archived assessments and dataset/model/evaluation matching is under clarification. Suggested text: “These are the archived profile statements. The matching dataset and evaluation records are being clarified. No independent held-out test has been identified in the supplied evidence.” Do not publish the private checkpoint analysis.

3. **Evidence dialogs can show a late response for a previously closed profile.** `openEvidence` checks only whether the dialog is open after its await. If A is opened, closed, and B opened before A returns, A's later response can overwrite B's dialog. Use an evidence request counter or abort controller, as already used for decision and job calls. Increment when starting a new request and invalidate on close. This is an evidence-display race, not a selector bypass.

## Verified or consistent

- The actual unchanged Python selector and job planner are called; the browser does not contain a separate hard-coded decision engine.
- All G1 profile settings match the settings inherited from the first profile, so copying `profiles[0]['settings']` does not accidentally exclude the other seven supported profiles.
- A direct probe returned SELECT after a valid confirmation and CONFIRM after changing B to C while supplying the old confirmation. The binding rejects stale consent. Frontend changes clear stored declarations, and request counters protect decision/job outputs from late fetch responses.
- The per-task UR5 selection explicitly says it does not reserve a person. The whole-job planner uses the original human-role table and original location/area checks. No bypass of those checks was introduced by the inspected wrapper.
- Shared checks default to unknown in the individual request. Presets explicitly declare hypothetical passing conditions. The page labels these assumptions and says no robot is commanded.
- Current E/F catalogue absence and historical admission failures are kept separate.
- G1 force RMSE cards correctly say four-second scored window. Detail text preserves window, pad side and units. Sample fractions are explicitly distinguished from trial success rates.
- No 99.5%-accuracy badge or inferred UR5 dataset size is displayed.
- UR3 image credit is given. G1 image is labelled recorded simulation.
- The server statically exposes only the public directory; evidence is accessed by known profile IDs, not arbitrary paths. JSON duplicate keys, excessive bodies and invalid input fields are rejected.

This review does not establish Vercel deployment readiness or scientific benefit over a careful planner. It checks the implemented demonstration against the existing evidence and rules.

## Correction recheck

Read the updated `public/app.js` and `public/index.html` after the fixes were applied. All three findings above are closed in the inspected code:

1. Force controls are now “Minimum force” and “Maximum force”, with an explicit statement that they affect every wiping task with a force requirement in the scenario.
2. UR5 details now identify their limits as archived profile statements and visibly qualify the current dataset/evaluation uncertainty. Exact stored source text remains intact.
3. Evidence requests now use a generation counter checked in both success and error paths; closing the dialog and opening provenance invalidate earlier responses.

Number-field `input` events also immediately clear task declarations and recalculate; jobs recalculate on number input. Existing request counters reject old responses. A separate browser check was reported: 7 N changed from CONFIRM to SELECT, then entering 8 N returned CONFIRM. This review inspected the implementation but did not repeat that browser interaction.

One layout point remains for a browser check: in the wide-screen CSS the A/C centres are 7% of map height apart. At the 270 px minimum map height that is 18.9 px, less than the 27 px button diameter, so overlap is possible. Mobile has explicit A/C label offsets. This is a presentation issue to verify visually, not a decision or evidence defect. No additional semantic blocker found in this narrow recheck.
