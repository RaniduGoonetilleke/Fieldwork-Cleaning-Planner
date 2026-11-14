/** A changed request can never accept an older answer. */
export function requestGate() {
  let version = 0;
  return {
    next: () => ++version,
    invalidate: () => ++version,
    accepts: token => token === version,
  };
}

export function removeTask(tasks, id) {
  return tasks.filter(task => task.id !== id).map(task => task.dependsOn === id ? {...task, dependsOn: null} : task);
}

export function clearedDependencies(before, after) {
  const original = new Map(before.map(task => [task.id, task]));
  return after.filter(task => original.get(task.id)?.dependsOn && !task.dependsOn).map(task => task.id);
}

export function updateTaskRound(tasks, id, round) {
  const updated = tasks.map(task => task.id === id ? {...task, round} : {...task});
  const byId = new Map(updated.map(task => [task.id, task]));
  return updated.map(task => task.dependsOn && (!byId.has(task.dependsOn) || byId.get(task.dependsOn).round >= task.round)
    ? {...task, dependsOn: null} : task);
}

function exactExportText(value) {
  if (typeof value !== 'string' || !value.length) throw new Error('The server did not provide the exact plan text.');
  JSON.parse(value);
  return value;
}

export function planDownload(value, name = 'fieldwork-plan.json') {
  const blob = new Blob([exactExportText(value)], {type: 'application/json'});
  const href = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = href; link.download = name; link.hidden = true;
  document.body.append(link); link.click();
  setTimeout(() => {link.remove(); URL.revokeObjectURL(href);}, 10000);
}

export function freshRoomChecks() { return {routes:'UNKNOWN',people:'UNKNOWN',hazards:'UNKNOWN'}; }
export function freshTaskChecks() {
  return {surface:{permission:'UNKNOWN',condition:'UNKNOWN',method:'UNKNOWN'},manual:{permission:'UNKNOWN',equipment:'UNKNOWN',training:'UNKNOWN'}};
}
export function freshSpecialist() { return {accessPlan:'',weather:'UNKNOWN',ground:'UNKNOWN',publicProtection:'UNKNOWN'}; }
export const nameKey = value => value.normalize('NFKC').toLowerCase().replace(/\p{P}/gu, ' ').trim().replace(/\s+/gu, ' ');
export function newBuildingReference(random = globalThis.crypto) {
  if(typeof random?.randomUUID === 'function')return 'building-' + random.randomUUID();
  const bytes=new Uint8Array(16);random.getRandomValues(bytes);
  return 'building-' + Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
}
export function invalidateAssessment(value) {
  return {...value, review:{...value.review, decision:'UNKNOWN', scope:null}};
}
export function assessmentScope(value) {
  const copy=structuredClone(value); delete copy.review; return copy;
}
const placeIdentity = task => task.roomId + '\u0000' + task.placeId;
export function updateTaskCheck(tasks, id, group, key, value) {
  const allowed=freshTaskChecks();
  if(!allowed[group] || !(key in allowed[group]) || !['UNKNOWN','PASS','FAIL'].includes(value)) throw new Error('Unknown task check.');
  const source=tasks.find(task=>task.id===id); if(!source)return tasks;
  const shared=group==='surface' && ['permission','condition'].includes(key);
  return tasks.map(task=>task.id===id || (shared && placeIdentity(task)===placeIdentity(source))
    ? {...task,checks:{...task.checks,[group]:{...task.checks[group],[key]:value}}} : task);
}
export function updateRoomCheck(rooms,id,key,value) {
  if(!(key in freshRoomChecks()) || !['UNKNOWN','PASS','FAIL'].includes(value))throw new Error('Unknown room check.');
  return rooms.map(room=>room.id===id?{...room,checks:{...room.checks,[key]:value}}:room);
}
export function resetChangedTask(tasks, id, key, value) {
  if(!['method','access'].includes(key))throw new Error('Unknown task field.');
  return tasks.map(task=>task.id===id?{...task,[key]:value,
    checks:{surface:{...task.checks.surface,method:'UNKNOWN'},manual:freshTaskChecks().manual},
    specialist:key==='access'?freshSpecialist():task.specialist}:task);
}
export function renameRoom(request,id,name) {
  return {...request,rooms:request.rooms.map(room=>room.id===id?{...room,name,checks:freshRoomChecks()}:room),
    tasks:request.tasks.map(task=>task.roomId===id?{...task,checks:freshTaskChecks(),specialist:freshSpecialist()}:task)};
}
export function renamePlace(tasks,id,name) {
  const source=tasks.find(task=>task.id===id);if(!source)return tasks;
  return tasks.map(task=>placeIdentity(task)===placeIdentity(source)?{...task,place:name,checks:freshTaskChecks(),specialist:freshSpecialist()}:task);
}
export function moveTaskPlace(tasks,id,roomId,placeId,place) {
  const existing=tasks.find(task=>task.id!==id && task.roomId===roomId && task.placeId===placeId);
  return tasks.map(task=>task.id===id?{...task,roomId,placeId,place,access:'UNKNOWN',checks:{...freshTaskChecks(),surface:{...freshTaskChecks().surface,
    ...(existing?{permission:existing.checks.surface.permission,condition:existing.checks.surface.condition}:{})}},specialist:freshSpecialist()}:task);
}
export function resetBuildingChecks(value, key, text) {
  if(!['company','customer','buildingId','buildingName'].includes(key))throw new Error('Unknown building field.');
  return invalidateAssessment({...value,context:{...value.context,[key]:text},siteChecks:{accessArranged:'UNKNOWN',siteRulesReviewed:'UNKNOWN'},
    rooms:value.rooms.map(room=>({...room,checks:freshRoomChecks()})),tasks:value.tasks.map(task=>({...task,access:'UNKNOWN',checks:freshTaskChecks(),specialist:freshSpecialist()}))});
}
export function recordAssessment(value, decision, today = new Date().toISOString().slice(0,10)) {
  if(!['UNKNOWN','PASS','FAIL'].includes(decision))throw new Error('Choose an assessment answer.');
  const date=value.review.date;
  if(decision==='PASS' && !value.review.by.trim())throw new Error('Enter who checked this assessment.');
  if(date || decision==='PASS'){
    const parsed=new Date(date+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==date || date>today)throw new Error('Enter a valid assessment date, no later than today.');
  }
  return {...value,review:{...value.review,decision,scope:decision==='UNKNOWN'?null:assessmentScope(value)}};
}
