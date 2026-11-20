# Fieldwork: plan a cleaning job

Enter a building job, choose the team, record the work checks and save a resource plan. A second job shows which resources are already booked.

Manager interface: `building-planner-20261115`. The research service keeps its existing `manager-pack-r5-20261114` identity.

**This is a planning demonstration.** A booking holds resources in a local draft. It does not establish robot suitability, approve work or start a robot. The research evidence and its decision rules remain available separately and are unchanged.

## Start locally

Use Python 3.12. No external Python packages are needed.

```bash
bash run.sh --check
bash run.sh --port 8767
```

Open `http://127.0.0.1:8767/`. Stop the server with Ctrl+C, or choose another port if necessary. The launcher uses `PYTHON_BIN` if supplied, otherwise looks for Python 3.12. Serve the files through this server rather than opening the HTML from a file browser. The manager calculation runs in the browser; the optional research view also needs the Python API.

## Plan the work

1. **Job.** Enter the building, job and place. For windows, add their number and rough width and height in metres. Group different sizes separately and choose inside, outside or both faces. The total assumes rectangular windows; it is not a work-time estimate.
2. **Team.** Choose a robot with its helper, or choose the Cleaner or Robot helper for manual work from their own cards. All resources begin available in an empty plan. Robot models turn slowly while hovered or selected; people stay still. Selecting a different team updates the cards without reloading their models. Reduced-motion settings keep the models still too. Mark any resource already busy elsewhere.
3. **Checks.** Record permission, the area, the surface and method, people, equipment and access. Unknown answers stay **Not checked**. These are entered answers; the app does not inspect a workplace or validate a capability.
4. **Plan.** Save an unfinished draft or reserve the resources once the checks pass. Add another job to see what is still free. Download a readable PDF of the saved jobs.

The prototype has UR3, UR5, G1 and two example people. Each robot reservation also needs the same helper, so booking one robot can leave another waiting for that person. Selecting a resource does not claim it has been tested for that building. Robot suitability still needs confirmation outside this interface.

Jobs in the same stage compete for the same resources. Stage 2 represents work afterwards, without measured duration, travel time or cost. Reservations cover this browser's current building draft, not a shared company calendar. The app does not choose the best robot or optimise a schedule.

Changing job details clears the corresponding checks; changed building details release existing bookings and reset their checks. A saved draft holds no resources. Facade work and specialist access can be recorded as drafts but cannot reserve resources through this prototype. Checks do not replace the company's risk assessment or authorisation process.

There are no starting examples on the manager page. **How it works** gives a short written guide. **Research evidence & examples** opens the separate research view. Its earlier captioned video shows that research workflow, not this manager interface.

## Downloads and independent checks

**Download plan PDF** produces a readable copy of saved jobs, quantities, resource bookings, entered checks and remaining issues. Unsaved edits are not included. PDF pages are images, so their text cannot be selected; the browser view remains available.

The two optional JSON exports have different purposes:

| Export | What it reproduces | Command from the repository root |
|---|---|---|
| Manager booking export (`fieldwork-booking-export-v1`) | Entered jobs, approximate areas, checks and provisional bookings | `node replay_booking.mjs fieldwork-booking.json` |
| Research plan export (`offline-plan-export`, schema 2) | Python evidence decisions and research planning results | `python3 replay_plan.py fieldwork-building-plan.json` |

Use the corresponding release for either export. The manager's **Optional independent check** also checks a saved booking file in the browser without importing it. The research view keeps its existing service-based replay. Neither check verifies the truth of entered answers, robot performance or completed work. PDFs and notebook backups are not plan-replay files.

## Robots and results

The shared **Robots & results** notebook stores proposed robots, test results and review notes in this browser. These entries do not enter either planning calculation, qualify a robot or change resource availability. The notebook records names without authenticating them. A future capability update needs a technical evidence review and a compatible, reviewed software release.

## After the work: job reviews

Choose **Record this job’s outcome** for a saved job, or open **Robots & results → Job reviews**. Record what happened, who did the work, extra help or difficulties, and anything done differently. A supervisor records acceptance or a request for more work separately on the saved note.

Changing what happened removes the recorded check. Saving with nothing changed keeps the check. Earlier answers and earlier checks are not kept.

The job and place of a note that is tied to a plan cannot be retyped. Link to a different planned job or detach the note to change what it concerns; either action clears its check. A link identifies the saved plan snapshot. It does not show that the work happened, and it is not a verified approval. The app does not check that the plan can still be worked out again.

If the note is changed in another tab or window after a form was opened, that form is refused and nothing is saved. Reload the saved note and read it before acting again. The refused action is never repeated for you.

Research examples and the notebook's example entry remain marked as invented. An invented example is left out of the counts, checked or not, and the mark stays if the note is later detached or linked to another job. Other entries are typed notes, and nothing checks that they describe real work.

A job review never changes a plan or what a robot may be offered. It does not release a booking. The supervisor accepting a result is a different thing from showing that a robot can do the job. No job review has been collected from real work. The notebook shows counts, not a cleaning-performance percentage.

## Research view and evidence

The footer link opens `/research.html#team`; `/research.html#customer` retains the building-evidence form. Their methods, examples, replay instructions and previous release checks are in [Research workflow](docs/RESEARCH_WORKFLOW.md). Specific robot capability details belong there rather than on the manager's resource cards.

The original selector, job planner and bundled research records under `vendor/` are unchanged. The manager's provisional bookings are a separate demonstration and never become evidence-supported robot assignments in that selector. The app contains neither the full G1 simulator campaign nor our private UR5 code, model or dataset.

One bundled UR5 record has a **pending correction**: `vendor/records/UR5_OPERATION_CONFIRMATION_R37.json` contains stronger contact-force wording than our sources support. The supported statement is:

> We did not implement active contact-force regulation in our UR5 prototype, and we report no measured contact-force value.

The historical record stays unchanged; the evidence API returns the correction beside it. A reviewed successor research release must resolve the record and its dependent identities together.

## Check the software

```bash
bash run.sh --test
for frontend_check in tests/test_*.mjs; do node "$frontend_check" || exit; done
python3 verify_release.py
```

The research tests continue to check the research view. The added booking tests cover quantities, reservation conflicts, edits, browser-store revisions and exact exports. Test counts from earlier releases are historical; checks of this successor are recorded in its verification summary when completed. Passing software checks do not establish planning benefit or safety.

## GitHub and Vercel

Upload this folder's contents at the repository root, keeping the folders and dotfiles. Keep `api/`, `vendor/`, `provenance/`, `public/`, `docs/`, the root scripts, `.python-version` and `vercel.json` together. Use Vercel's **Other** preset and the supplied configuration; no API key or environment secret is required.

After deployment, check the manager flow, two jobs sharing a robot or helper, both themes, a downloaded PDF and both export/replay routes. Check the research page separately. Local testing does not verify a future GitHub download or hosted deployment.

## Data and model sources

Saved bookings, notebook entries, job reviews and the theme stay in browser storage. Clearing it removes them. Unsaved form edits can be lost on reload. The research API calculates requests in memory without an application database. A host may retain access logs. Names, building details and reviewer names are entered text; use fictional details when sharing examples. Evidence links are not fetched automatically.

Robot meshes come from Universal Robots and Unitree; the person models are Quaternius's CC0 Background Posed Humans. Their licences and source records remain under `public/models/` and `provenance/`. The models illustrate resources only. Their turn is a display effect, not simulated robot motion. The G1 display mesh is not the exact model used in the simulation experiments. The fallback SVG drawings are included with this app.

The research tour's quiet music is Blue Skies by HoliznaCC0 from Lazy Summer Lofi (CC0 1.0); its source is recorded in `provenance/WALKTHROUGH_MUSIC.json`. The app works without the video or WebGL.
