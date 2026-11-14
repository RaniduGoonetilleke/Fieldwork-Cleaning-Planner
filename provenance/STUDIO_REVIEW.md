# Scientific and interaction review

6 November 2026. Bounded review of `public/studio.js`, `public/app.js`, `public/index.html`, relevant scene methods, and the chart data. No implementation file edited. This records findings on the implementation as inspected before the corrections recorded below.

## Required corrections

1. **Failed requests leave the old studio answer visible.** `app.js:evaluate` clears `state.decision` and updates the original planner panel when validation or the API fails, but it emits no error/invalidation event for the studio. The studio retains `local.data`, old decision text and scene state; pending=false then re-enables pinning that stale answer. Emit an error event or a null decision, clear studio data/actions/pinning and stop the preview. Keep the shared error text visible. A failed current request must never appear to inherit a previous SELECT.

2. **Accepted force ranges become an incorrect single-force scene label.** `updateScene` sends `inputs.force.min` to `setForce`. A 6–8 N request is thus labelled “6 N request” in the scene even after the owner chooses the 8 N profile. The preview is also disabled because 6 is not one of the two recorded settings. Show the accepted range until an option is selected, then use `result.configuration.force_setpoint_n` for the chosen illustration, keeping the range visible in the request controls. Do not imply 6 N was recorded.

3. **The scene can animate a task beside a refused or unsupported decision.** Preview availability checks the location/force, not the decision. `setDecision` changes colours only. Thus an assumed hazard or a physical G1 request may display REFUSE/WITHHOLD while the same selected location still plays a wipe; pending confirmation can similarly play through. Make preview availability depend on a current, non-pending SELECT and a matching recorded G1 setting, stopping/resetting animation when the decision changes. If the design instead provides a historical-workflow explorer, that must be visibly separated from the current request and use its own selected recorded configuration. The current combined layout does not make that separation.

## Small wording corrections

- “operator / attendant · booked in job planner” can imply someone was already booked for this request. Use “requires booking in job planner” or “checked separately by the job planner”.
- The force chart remains visible while UR3/UR5 or E/F is selected. Explicitly call it “Recorded G1 force” and keep its own A–D location label, so the chart is not attributed to the displayed arm or untested site.

## Checks that passed

- The studio bridge calls the same decision API as the original form. It clears choices/confirmations whenever a patch changes the inputs. Confirmation and choice functions reject actions while a request is pending and use the current backend binding. The original request counters reject late decision responses. No independent mock decision engine was introduced.
- Presets use authored passing checks and identify that assumption; the default individual request has unknown conditions. Fast updates read the current form, so successive target/force changes do not deliberately reconstruct from a stale response.
- The scene and its animation are explicitly described as illustrative, not a physics simulation or recorded replay. Camera orbit is not treated as new visibility evidence. E/F historical admission explanations remain separate from the current deployment evidence gap.
- Independently reloaded all eight NPZ files and compared every chart value: all **6,400 force values**, relative times and actual phase times match exactly. Recomputed RMSE and window minima/maxima also match exactly. No generated, smoothed or downsampled waveforms.
- Plot mapping uses the correct 7 N and 8 N series, sample positions and force units. RMSE cards are derived from those same four-second windows. The displayed last tick rounds the final 3.995-second sample offset to “4 s”, while the hover reading retains milliseconds; the source asset preserves both absolute and phase-time definitions.
- The chart note discloses that it is a four-second scored window, not the whole wipe/final hold. Location A's development-role caveat is visible.
- No detector accuracy, new physical G1 result, measured cleaning success, optimal-force result or user-study benefit was added by the inspected interface.

At the time of this review, browser and visual checks were in progress separately. The three required findings here follow directly from the code paths; this review did not exercise the browser. Corrections should receive a short interaction recheck before delivery.

## Correction recheck

Read-only code recheck on 6 November 2026: all five findings above are addressed in the current files.

- **Failed request:** both decision-evaluation errors and bootstrap errors emit `fieldwork:error`. The studio handler clears its current data, result actions and route, hides the comparison panel, disables pinning/play/scrub and resets scene decision/progress. `setPending(false)` cannot restore the old result because current data is null. Late API responses still face the existing request-ID check.
- **Force range:** the scene uses the selected configuration's force where available. Otherwise it uses an exact force or a label such as “6–8 N accepted range” with no single force value. A chosen 8 N option therefore no longer appears as a 6 N request. The request controls continue to show the owner's accepted range.
- **Preview gating:** the studio requires a current SELECT, a ready scene and no pending request; G1 additionally requires A–D and a recorded 7/8 N setting. Pending requests immediately stop playback and disable the controls. The scene itself now rejects play/scrub while the decision is not SELECT and refuses E/F animation. Changing the decision away from SELECT resets progress. The completion event checks `local.playing`, and `stopPreview` clears it before emitting another scene event, which removes the identified completion-recursion path.
- **People:** the route now says “requires booking in job planner”, so the individual selection does not claim to reserve an operator or attendant.
- **Chart attribution:** the chart explicitly says “RECORDED G1 DATA / NOT ANIMATION”, names the G1 in its heading and identifies the right-pad four-second scoring window. Its independent A–D selector remains visible.

No further material scientific-meaning or consent-state issue was identified in this bounded correction recheck. This recheck inspected the code. Final browser interaction checks were still in progress separately when it was recorded. No implementation file, manuscript, original evidence or milestone was changed by this review.
