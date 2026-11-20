# Research workflow and preceding release notes

This document preserves the research workflow and release notes supplied with `manager-pack-r5-20261114`. Open `/research.html#customer` for that building-evidence view or `/research.html#team` for the tested examples. The new manager booking workflow opens at `/` and is described in the [current README](../README.md).

The instructions below use paths relative to the repository root. References to the main page, one-click examples, the Quick tour and the previous test counts belong to that preceding research interface. Its video does not show the new booking workflow. These historical checks are not new checks of the manager interface.

The research view calls the Python evidence rules. The manager view makes provisional resource reservations separately. A reservation neither supplies evidence to those rules nor changes any of their decisions.

---

## Preserved documentation: plan with people and robots

Describe a cleaning job, say who is available, and see what can be planned and what still needs attention.

Release: `manager-pack-r5-20261114`.

The main downloads are readable PDF reports for managers. Exact JSON files remain optional research exports or notebook backups. Planning and evidence rules are unchanged.

**This is an offline planning demonstration.** Conditions and human skills are entered as example facts. No robot is connected, no workplace is inspected, and nothing is dispatched.

Choose **Quick tour** for a captioned walkthrough with quiet background music and no narration. It covers planning, downloading a readable plan, recording an outcome and the separate supervisor check. It uses invented building answers and notebook entries, plus recorded G1 simulation evidence with invented current conditions. A written walkthrough is available below the video. The music is Blue Skies by HoliznaCC0, from Lazy Summer Lofi, released under CC0 1.0; the source is recorded in `provenance/WALKTHROUGH_MUSIC.json`. The app works without playing the video.

## Start locally

Use Python 3.12. The app needs no external Python packages.

```bash
bash run.sh --check
bash run.sh --port 8767
```

Open http://127.0.0.1:8767/. Stop the server with Ctrl+C. Choose another port if necessary. The launcher uses `PYTHON_BIN` if supplied, otherwise looks for Python 3.12. Opening `public/index.html` directly does not run the planner: the Python API must be available.

## Plan a job

The page opens on **Plan a job**, a four-step flow.

1. **Job.** Name the building and add jobs: whiteboards, interior glass, wall marks, desks, floors, ordinary bins or outside building surfaces. The building name is needed. Customer and company help identify the building, so changing them clears the checks. The job name is a note.
2. **Team.** Say when each of the two people is free. Each robot card shows what the robot was shown to do, the person it needs and that its recorded evidence does not cover a new building.
3. **Checks.** Answer the building, room, place and work checks with labelled buttons. Unknown answers stay **Not checked**. Room answers are given once and apply to every job in that room. Then record the assessment: a typed name, a date and a decision.
4. **Plan.** One sentence says how many jobs are assigned and how many need attention. Each job has its reason, its next step and a **Why this result?** section.

**Why this result?** explains the answers that decided the job and the robot evidence part by part. Tasks that reach staffing also show what happened with each person. **About this plan** explains the scope, software checks and optional plan replay in plain language. It does not display raw records or terminal commands.

Step 1 also offers one-click examples with invented answers: two jobs with both people free, a helper already busy, a failed shared room check, a job changed after its assessment, a G1 simulation request with and without its helper, and a new robot result waiting for review.

The checklist is informed by UK HSE cleaning guidance. It is a set of questions we wrote, not an HSE-approved form, a complete risk assessment or a safety certificate. A typed reviewer name is not authenticated approval. Checking every box does not prove that the place is safe.

A recorded positive assessment belongs to the exact inputs. Editing those inputs clears it. Missing, incomplete or stale assessment details keep the plan unresolved. A future review date is rejected. Explicit negative answers remain blocking. Changing the company, customer or building clears its checks. Renaming a room or place clears the affected checks. A method change clears the task's method and manual-work answers, while shared room facts stay in place. The app explains why a new assessment is needed. The server derives the planning conditions from these answers and refuses legacy direct PASS overrides.

The two stages show logical order, with no measured duration or completion-time estimate. This version handles one building per plan. It does not coordinate staff bookings across separate plans or buildings. A dependency is not evidence that the earlier task has actually finished.

This version has two example people and two stages. Their labels can be changed, but a label does not establish a real identity. At most two manual jobs can be assigned in a stage. For each stage, the app assigns as many eligible, ready manual jobs as the available people can cover. If several assignments cover the same number of jobs, it uses a fixed rule to choose between them. It does not minimise travel, time, cost or workload, and it does not optimise across stages. Dependencies and all permission and condition checks still apply. The original paper planner and its declared ordering are unchanged.

The example robot helper starts with declared glass and whiteboard skills. The glass cleaner starts with a glass-cleaning skill. Adding another skill records a declaration, not a certificate. A person can be reserved for only one task in a stage and needs the task's required skill. Permission to consider manual work does not record worker consent.

Unknown or specialist access blocks the ordinary manual route. Outside building surfaces always stay in specialist review, even if every checklist answer is checked. The specialist prompts record proposed access, weather, ground and public-protection checks; they do not approve facade work, industrial robot installation or drone operations.

## Investigate other robot options

The expandable suggestions list shows manufacturer-described products related to the selected jobs. The initial shortlist includes Skyline Robotics Ozmo, Kite's facade robot, the pilot-operated Lucid Bots Sherpa drone, Karcher KIRA B 50 and CV 50 floor robots, and ECOVACS WINBOT W2 PRO OMNI as a consumer window product. Its commercial suitability is unestablished.

Each card says **Not in your team** and **Not tested here**, links its source and lists unresolved checks. These are research candidates, not qualified assignments, purchasing recommendations or a ranking. They do not enter the robot roster, capability register, planner or assignment counts. Some task types have no verified product match in this shortlist.

For a new building, each job is split into the parts a robot would need, and every part is compared with the unchanged records. A whiteboard job, for example, needs the marked area found, the surface wiped with a set pressing force and a clean result shown. Where a truthful request can be formed, the unchanged decision rule is asked. That is the case for detection, and the request names the customer's own building and place. The rule withholds the robot, because the only detection record belongs to another setting. A wiping request needs a pressing force stated by the owner. The form does not ask for one, so the rule is not asked and the app says so. No part is supported in a new building, so no robot is assigned there. The detection check assumes that every current condition passes, only to isolate what the evidence covers. Your actual place checks are applied separately to the job plan. The building flow plans manual work only. Robot assignment there would need applicable reviewed evidence and a reviewed update to this planning route. The gaps listed for each part are evidence gaps. Closing them would not, by itself, qualify a robot. A request is never altered to obtain a recommendation, and a customer place can never share an identity with a tested record. Entering a job, ticking checks, recording an assessment or viewing a manufacturer's product does not create robot evidence. A permitted manual route is checked separately.

## Try the tested robot examples

**Tested examples** includes the original paper customer-building example alongside the recorded robot setups. The paper example retains its twelve tasks and original decisions; it is separate from the editable new-building form. The selector runs for supported request types in those recorded examples.

The recorded robot setups cover:

- G1: supported wall wiping in simulation at a recorded 7 N or 8 N setting, with a helper and separate example confirmation.
- UR5: visual detection of the taped region, with an attendant. The registered capability does not qualify a complete regulated-force cleaning task.
- UR3: registered-cube handover in the published cell. It does not qualify fetching arbitrary cleaning supplies.

An acceptable force interval can admit recorded settings inside it; it does not establish every value in the interval. Exactly 7.5 N is withheld, because no tested setting matches it. That is missing evidence, not a failed check. Changes to requirements or conditions invalidate earlier example declarations.

The optional **Show 3D team** button loads the detailed illustrations. Planning controls work without WebGL or model loading. Dark is the initial theme; the Light/Dark switch changes it.

## Check and reproduce a plan

The main **Download PDF** button saves a readable report. It includes the jobs, team, decisions and reasons, with the scope of the plan. PDFs are rendered locally as page images so names and other text use the browser’s font support; text in the PDF is not selectable. The accessible app view remains available. A PDF is a reading copy, not a replay file.

Open **About this plan** for **Check it now**, which asks the service to work the plan out again from the saved inputs and compare. The optional research export keeps the exact JSON needed for independent replay. Download that JSON into this folder and run:

```bash
python3 verify_release.py
python3 replay_plan.py fieldwork-building-plan.json
```

The first command confirms the files match this release. The second prints a line starting with `PASS` when the plan is reproduced. Use Python 3.12 for this merged release. Its checks are recorded below; the earlier correction-only app was also checked with Python 3.10.12. The JSON contains the inputs, the full result with its explanations, and the software and evidence identities.

Replay recalculates the plan and compares it with the exported result. Customer exports record the UTC date used to admit the assessment; replay uses that recorded date, so a different computer date does not change the result. That context reproduces an offline calculation and is not authenticated approval for work today. It does not trust a saved claim of success. Use the same app release; if code or evidence differs, inspect the difference before comparing outputs.

For API clients, save `exportText` exactly as returned. Send it to `/api/replay` as `{"exportText": "…"}`. Re-serialising the `export` object in JavaScript can change number spelling and invalidate the identity check.

This reproduces planning decisions. The app does not include the complete G1 simulator campaign, all raw journals or our private UR5 code, model and dataset. It cannot reproduce all robot experiments.

## Robots and results notebook

**Robots & results** stores proposed robots, outcomes and review notes in this browser. You can export those notes.

The notebook shows three stages: saved here, reviewed here, and admitted to the planner. The third always shows none of your entries. **Add an invented example result** saves a result marked Passed so you can see that plans do not change.

Saving a result or recording a local review does **not** add it to the planner. Admission needs compatible task definitions, evidence, operating conditions, human roles and a checked catalogue update. For the building flow it also needs a reviewed update to the planning route. The notebook does not authenticate reviewers or verify experiments. Editing an entry clears its review; clearing browser storage removes local notes.

## After the work: job reviews

On the plan screen, open **After the work: record what happened** and choose **Record a job outcome**. The form opens in the notebook's **Job reviews** tab with that plan's jobs listed. You can also open the tab from **Robots & results** and type a job yourself.

A note has three parts, and the app keeps them apart:

| Part | What it holds |
|---|---|
| The planned job | A note started from a plan keeps a copy of that job: the building, the room and place, the job, the method asked for, the stage, what the plan said and the plan's fingerprint. The copy cannot be edited. A typed note has no plan link. |
| What happened | Completed, partly completed, stopped, not started or not known. Who actually did it: a person, a robot, a robot with human help, or not known. Whether extra help was needed: someone had to step in, part was cleaned again, an equipment problem or another difficulty. Anything done differently from the plan goes in its own field. |
| The supervisor's check | Accepted or needs more work, with a typed name and date and an optional note. It is recorded by its own action on the saved note, and it is judged against what the job asked for. |

It covers work done by people as well as by robots.

Changing what happened removes the recorded check. The note then reads "Changed after its check: check again", and a new check has to be recorded for the note as it now stands. Saving with nothing changed keeps the check. Earlier answers and earlier checks are not kept.

The job and place of a note that is tied to a plan cannot be retyped. To change what the note is about, link it to another planned job from an open plan, or detach it. Linking replaces the whole copy with the newly chosen job. Detaching removes the plan link and asks for a typed job and place. Both remove the check.

A plan link shows which planned job a note was started from. It does not show that the work happened, and it is not a verified approval. The app does not check that the plan can still be worked out again.

Each form belongs to the version of the note it shows. If the note is changed in another tab or window after a form was opened, that form is refused and nothing is saved. This covers recording or removing a check, saving a change, linking, detaching, archiving and restoring. The page then shows the note as it is saved, with its forms empty, and you have to read it and act again. The refused action is never repeated for you. A tab that is told about the change marks the note "Out of date" before you act, but the refusal does not depend on that mark.

A note started from a plan made from a one-click example is marked as an invented example. So is a note linked to such a plan, and a note saved by **Add an invented example review**. An invented example is left out of the counts, checked or not, and the mark stays if the note is later detached or linked to another job. The app cannot tell whether a scenario you typed yourself is real. Notes from it are counted as your own typed notes, and nothing checks that they describe real work.

A job review never changes a plan or what a robot may be offered. It is saved in this browser only and is never sent to the planning service. The supervisor accepting a result is a different thing from showing that a robot can do the job. The tab lists the steps that would still be needed: a technical review of the evidence, then a reviewed capability record. Neither is possible in this app.

The tab shows counts of your own typed notes: how many were accepted, need more work or are not checked, and how many recorded extra help. It shows no percentage, because a count of typed notes is not a success rate. Invented examples are named separately and never added to these counts. The PDF download gives a readable copy, including outcomes and the separate supervisor checks. The collapsed **Data backup (JSON)** option keeps the full machine-readable record.

No job review has been collected from real work. The step shows where information about finished work would return to the framework. It is manual recording, with no automatic learning and no live link to a robot or a building. Names are typed and not verified. A photo reference is saved as text, and nothing is uploaded. There is no structured measure of how clean a surface is.

## Verify the software

```bash
bash run.sh --test
```

This runs the Python tests. Frontend logic checks use Node.js:

```bash
for frontend_check in tests/test_*.mjs; do node "$frontend_check" || exit; done
```

The release-file check is also available separately:

```bash
python3.12 -B verify_release.py
```

Checks cover decision rules, customer inputs, people, place conditions, dependencies, stale declarations, input validation, the part-by-part robot evidence check, explanations, exported plans and the job-review notes. **Software checks and test counts** in **About this plan** summarises them and states their limits. They do not establish physical safety, cleaning effectiveness, user comprehension, a reliability figure or a benefit over another planner.

## Update GitHub and Vercel

Put this folder's contents at the root of the app repository, preserving folders and dotfiles. Keep `api/`, `vendor/`, `provenance/`, `public/`, root Python modules, `.python-version` and `vercel.json` together. Uploading only the HTML files will not work.

Use Vercel's **Other** framework preset. The configuration serves `public/` and includes the Python API dependencies. No API key or environment secret is required. Prefer a preview deployment and check the actual hosted build before sharing it.

Keep the walkthrough assets under `public/assets/`. They are static files and do not belong in the Python function bundle. The local server supports byte-range requests for seeking in the video. Check playback and seeking on the actual hosted preview too.

Open each one-click example, then check unknown place conditions, a permitted manual glass task, two tasks competing for one person, the part-by-part robot evidence in **Why this result?**, and the separate tested G1 confirmation. Download a hosted PDF to inspect its layout, and use the optional JSON research export to replay the plan locally with this release. Local checks do not establish that a future Vercel deployment works.

## Sources and scope

The unchanged decision and job-planning implementation is under `vendor/`. Its copied sources are checked against `provenance/SOURCE_MANIFEST.json`. New customer templates are separate authored scenarios. The bundled evidence comes from the corrected 6 November source package. Its portable source labels and dependent file identities were updated together; scientific values, decision rules and historical planning outcomes are unchanged. Task sources are listed in `provenance/CUSTOMER_TASK_SOURCES.txt`; checklist guidance and manufacturer sources are in `provenance/SITE_CHECK_AND_ROBOT_SOURCES.txt`. The six product cards were checked against their manufacturer pages on 10 November 2026. Product descriptions may change. Absolute development-machine paths have been replaced with relative source identifiers in app preparation metadata. The private preparation record preserves the original source locations. Development review notes are included under `provenance/`. The source substitution was checked across 41 complete planning outputs, including both paper scenarios, force requirements, team availability and new-building jobs. Only the documented source labels and dependent identity strings differ. Old exports must still be replayed with their matching release. This cleanup does not erase or revise the original evidence history.

UR3 and UR5 visual meshes come from Universal Robots, G1 from Unitree, and human figures from Quaternius's CC0 Background Posed Humans pack. Licences and source details remain under `public/models/` and `provenance/`. The displayed G1 mesh is not the exact five-finger model used in the Isaac experiments.

The app has not been evaluated with cleaners or service planners. It demonstrates initial deployment-planning infrastructure. Live integration and measurement of practical benefit remain separate work.

## A bundled record with a pending correction

`vendor/records/UR5_OPERATION_CONFIRMATION_R37.json` is an unchanged copy from our research release. It says twice that no contact-force value "was measured", once in point C5 and once in its interpretation list. That is stronger than our sources support. The supported statement is:

> We did not implement active contact-force regulation in our UR5 prototype, and we report no measured contact-force value.

Our sources do not establish that no measurement was ever made. The record is not edited here, because the app bundles exact copies. It will be corrected through a reviewed successor record in the research release and then copied into a later app release. Until then, `/api/evidence` returns this correction beside the record. The page itself does not display the sentence.

The bundled historical records also hold the values reported in our UR5 study, such as the reported mAP50. The app does not evaluate the detector protocol and does not use those values in any decision.

## Data handling

Requests are calculated in memory and not saved to an application database. Company, customer, building and reviewer text is user-entered; these fields do not establish a company account or identity. Downloaded plans can include names or places you enter; use fictional examples when sharing them. The notebook, job reviews and theme use browser storage. Job reviews can hold the names and places you type; use fictional ones when sharing a copy. A hosting provider may retain normal access logs. Evidence links entered into the notebook are not fetched automatically.

## Customer-view update checked on 13 November

The preceding manager-pack-20261113 release passed 309 Python tests on Python 3.12.14 and all 15 JavaScript test files on Node 24.22.1. A code review during development identified two omissions in readable reports: a selected setting while a helper waits, and passing condition declarations. Both were fixed and rechecked. Exact JSON exports still pass their byte-for-byte checks.

Six actual browser-generated PDF examples were rendered and visually checked across 18 pages: a customer plan, a selected G1 setting with a helper conflict, the paper's original plan, the robot notebook, job reviews, and long Unicode/text entries. PDF pages are image-based; their text cannot be selected or searched. The browser view and optional JSON preserve other ways to read the information. No screen-reader or real-phone audit was performed.

The updated 2 min 32 sec tour contains 18 current app screens, captions, quiet CC0 music and no narration. The chapter titles slide in from the left on a semicircular panel, hold for 2.5 seconds and retract to the left. Each scene has two extra seconds to keep the original reading time after the panel leaves. The close-up app views are exported at 1920 × 1080. The screens were recaptured with 1.4× display zoom and cropped to the relevant controls. The browser capture tool supplies JPEG images; these are not native lossless high-resolution captures. Its full audio/video stream decodes, all scene frames were inspected, and playback progresses and pauses when the dialog is closed. The soundtrack was reduced by 24 dB from the downloaded source and fades in and out.

The preceding release's local browser checks cover the PDF controls, separate research/backup exports, plan replay, outcome recording, separate supervisor acceptance, and removal of a stale check after an edit. Both light and dark themes were inspected. A requested 390 px viewport override did not take effect in the attached browser, so a new phone-width check is not claimed. The earlier release's responsive checks remain historical evidence. No new robot results or planning logic were added, and a future GitHub download and Vercel deployment still need their own check.

The manager-pack-r2 update changes only the tour, its player proportions, documentation and release identity. The planning code, reports, notebook controls and research records match manager-pack-20261113. The tests and PDF checks above belong to that preceding release unless a new check is specifically named.

For manager-pack-r2-20261113, three targeted JavaScript contract checks passed again. The 1080p video passed a full decode. All 18 screen crops, chapter cards and an encoded-frame sample were also checked during development. Local Chromium playback reached 20 seconds, reported the full 116-second duration, and paused on closing the dialog. The player measures 935 px wide in the inspected desktop window; the dialog scrolls to accommodate the larger video.

For manager-pack-r3-20261113, all 18 semicircular title panels passed a preview check during development. The renderer was checked for a stationary 2.5-second hold, complete retraction and unobscured badges and captions. The 152-second encoded video passed a full decode. Local Chromium playback reached 27 seconds and paused when the dialog closed. The app logic is unchanged; only the video, caption timings, duration label, documentation and release identity differ from r2. The full software test suite was not rerun for this video update.

## Wording update checked on 14 November

This release simplifies the page explanations, maintenance comments and development notes. The code, data, third-party libraries, licences, images and video are unchanged except for the listed text edits and release identity. The 19 bundled research files remain exact copies.

All 309 Python tests passed on Python 3.12.14, and all 15 JavaScript test files passed on Node 24.22.1. A comparison of 1,500 generated customer requests gave identical planning outcomes. A fresh plan export replayed correctly; a changed result and an export from the preceding release were refused. The local browser check covered the customer example, the revised explanations, notebook wording and plan replay in the existing desktop browser, with dark and light themes inspected. This was a focused check of the wording changes, not a new full browser or accessibility audit.

The checks above were run locally. The new GitHub download and Vercel deployment still need to be checked after upload. Keep earlier app versions for replaying their own saved plans.
