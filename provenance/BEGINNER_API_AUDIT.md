# Beginner flow: API and meaning check

Reviewed `planner_service.py`, `server.py`, the existing `public/team.js`, and `tests/test_service.py`. Direct calls below used the existing backend without changing it. The only new files from this task are this review and `tests/test_beginner_contract.py`.

## Recommended route

Use `POST /api/job` for the beginner flow. It checks the worker's roles and bookings. Start with one selected robot in `robots`, then display the relevant row from the returned saved example. This API still evaluates the complete authored scenario; filtering its display does not create a new single-task planner.

| User chooses | Tested-example row | New-building row | Tested-example next step with H1 free |
| --- | --- | --- | --- |
| Hand over a cube · UR3 | `T-SH`, slot 2 | `SH1` | `PENDING_CONFIRMATION` |
| Find the taped region · UR5 | `T-WB-L`, slot 1 | `WB1-L` | `RECOMMENDED` |
| Wipe a wall in simulation · G1 | `T-WS-D`, slot 1, location D | `WS1`, a physical customer wall | `PENDING_CONFIRMATION` at exact 7 or 8 N |
| Clean glass by hand | Not offered in the tested-context menu | `GP1`, slot 1 | Uses the declared manual alternative |

The three new-building robot rows return `BLOCKED_EVIDENCE`, whether the helper is free or busy. The new building changes the requested context and target; G1 also changes from simulation to physical work.

The job API cannot change G1's tested target from D to A, B, C, E or F. Do not show a different location while using `T-WS-D`.

## Exact request and action contract

Example: G1 alone, exact 7 N, helper available, authored area checks passing:

```json
{
  "scenario": "tested_contexts",
  "robots": ["G1"],
  "peopleAvailability": {
    "H1": {"slot-1": "AVAILABLE", "slot-2": "AVAILABLE"},
    "H2": {"slot-1": "AVAILABLE", "slot-2": "AVAILABLE"}
  },
  "sharedSafety": "PASS",
  "force": {"min": 7, "max": 7},
  "declarations": {}
}
```

- UR3: use `robots: ["UR3"]`, omit `force`, display `T-SH`.
- UR5: use `robots: ["UR5"]`, omit `force`, display `T-WB-L`.
- G1 8 N: use `force: {"min": 8, "max": 8}`.
- Helper busy: set H1's relevant slot to `BUSY`. A simple whole-example switch can set both slots. H2 remains a separate person.
- New building: use `scenario: "customer_building"` and the customer row IDs above.
- Glass by hand: use `scenario: "customer_building"`, `robots: []`, and display `GP1`. No force setting or confirmation button is needed for its manual route.
- Area unknown: `sharedSafety: "UNKNOWN"`. Conflicting information also uses the unresolved route (`CONFLICTING`). A failed area check is `FAIL`.

Always render the task's **`state`** as the final answer. The nested selector result does not include worker bookings. For example, UR5's selector says `SELECT` while the full task says `WAITING_FOR_PERSON` when H1 is busy.

For a button action, use the current response verbatim:

```javascript
const action = response.availableActions.find(a => a.taskId === displayedTaskId);
payload.declarations = {
  ...payload.declarations,
  [action.taskId]: structuredClone(action.declaration)
};
// POST this payload to /api/job again.
```

Show only actions returned for the displayed task. Do not create a confirmation locally or automatically call it. After any task, context, roster, worker availability, force or safety change, clear `declarations` and request a new answer. Old bindings are rejected. If a range was offered and the user first chose 7 or 8 N, the later confirmation template also includes that choice; replace that task's complete declaration with the new template.

The force override applies to every regulated-wipe request in the saved scenario, not just the displayed row. Other task labels retain their authored wording, so derive the beginner force label from the current input/result, not a raw scenario label that still says “6–8 N”.

## Workers and bookings

- H1 can support robots **and** hand-clean glass and whiteboards. “Robot helper” is a useful short name, but must not imply that robot support is H1's only skill.
- H2 is trained for glass wiping and has no robot-support roles. A free H2 cannot replace a busy H1 on a robot job.
- GP1 is assigned to H1 when both people are free. With H1 busy, it goes to H2. With both busy, it waits.
- The glass route is an explicitly allowed hand-cleaning alternative. It is not proof that a person meets the original measured-force requirement.
- Adding UR5 to a G1 roster books H1 for `T-WB-L` in slot 1 before G1 is considered. G1 then waits for a person. This is the declared task order, not an optimised schedule or a claim that UR5 is better.
- “First round” and “second round” are logical slots with no measured duration. No job has actually finished because it appears in the plan.

## Short text for the result screen

Keep one headline, one reason and one next action. Put raw rule names, hashes, record identifiers, roles and all secondary tasks under an optional details panel.

| Backend task state | Suggested headline | One-line explanation or next step |
| --- | --- | --- |
| `RECOMMENDED` | This option fits | Your example has the evidence and helper it needs. |
| `PENDING_CONFIRMATION` | The helper must say OK | Button: “Add an example OK”. |
| `PENDING_CHOICE` | Choose a setting | Show only the returned options, without ranking one as best. |
| `WAITING_FOR_PERSON` | A free helper is needed | The available person must have the right skills. |
| `WAITING` | The robot is busy | It has another booking in this round. |
| `BLOCKED_EVIDENCE` | More evidence is needed | These records do not cover this job here. |
| `BLOCKED_NOT_IN_TEAM` | This robot is not on the team | Add the matching robot, then check again. |
| `WITHHELD_SHARED` | Check the area first | Its safety information is missing or unclear. |
| `BLOCKED_SHARED` | Work is blocked here | The area is marked unsafe. |
| `MANUAL_ASSIGNED` | A person can hand-wipe it | Show the actual assigned person and “allowed manual alternative”. |
| `CONDITIONAL_ON_INPUT` | Waiting for an earlier result | A plan for the earlier task is not its completed result. |
| `BLOCKED_INPUT` | An earlier step is missing | That step cannot currently provide the needed result. |

Keep a short, visible scope line: **“Practice plan. No robot is connected.”** The preset also needs **“Other checks are assumed to pass.”** These replace long repeated disclaimers without hiding the assumptions.

For G1, keep **“Simulation”** visible. Its recorded experiment used a scripted virtual hand; H1 is a declared planning role, not a human observed in those simulator trials. For UR5, use **“Find the region”**, not “Clean the board” or “Control the cleaning force”.

## Other endpoints and traps

- `GET /api/bootstrap`: cases, profiles, single-task presets, job presets, human roles and scope.
- `GET /api/evidence?id=G1_D_7N`: optional evidence detail for a known profile ID.
- `GET /api/health`: health only, no live robot status.
- `POST /api/decision`: useful for advanced single-request exploration, including A–F, but its `availability` means **robot availability**, not worker availability. It does not reserve a person.
- In `/api/decision`, `context: "customer"` alone leaves G1's domain as simulation. A physical customer-building request must also set `domain: "physical"`.
- In the advanced single-request route, no supplied live checks means UNKNOWN, so it withholds. The saved job route starts from authored scenario checks. Do not describe either as sensor observations.
- Free, reserved and confirmed are three different states. A tentative booking does not mean the helper has agreed. A browser button is a demonstration declaration, not a detected gesture, authentication or permission to operate hardware.
- An unknown area check and a failed check both prevent assignments, but are different reasons. Do not turn all blocked answers into “unsafe”.
- G1 at 7 or 8 N means a recorded setting, not a best force, continuous qualified range, maximum force or measured dirt removal.

## Checks performed

The existing adapter and test definitions were inspected. Direct backend probes confirmed all three tested-context robot rows with H1 free and busy, all three customer rows with H1 free and busy, and GP1 with both workers free, one busy, and both busy under PASS, UNKNOWN, CONFLICTING and FAIL area conditions.

Ten new focused tests pass under Python 3.12.14:

```bash
python3 -B -m unittest -v tests.test_beginner_contract
```

They cover the displayed task IDs, exact 7/8 N confirmations, customer gaps, worker shortages despite a nested SELECT result, glass-cleaning qualifications, area checks, competition for H1, stale declarations and the optional range choice. The existing 171-test module and backend are unchanged. To run both modules together:

```bash
python3 -B -m unittest -v tests.test_service tests.test_beginner_contract
```

The combined 181-test run was left for the separate integration check; this audit ran the ten new tests. No browser, external service, deployment or simulator was used.
