// This register is browser-local data. Its entries never modify the verified planner.
export const STORAGE_KEY = 'fieldwork.local-register.v1';
export const SCHEMA_VERSION = 1;
export const BUILTIN_ROBOTS = Object.freeze([
  Object.freeze({id:'UR3',name:'UR3',type:'Robot arm',domain:'physical'}),
  Object.freeze({id:'UR5',name:'UR5',type:'Robot arm',domain:'physical'}),
  Object.freeze({id:'G1',name:'G1',type:'Humanoid',domain:'simulation'}),
]);

const MAX_BYTES = 1_000_000;
const DOMAINS = ['physical','simulation'];
const OUTCOMES = ['PASS','FAIL','INCONCLUSIVE'];
const ROBOT_FIELDS = ['name','type','domain','notes'];
const RESULT_FIELDS = ['robotId','task','context','location','date','outcome','evidence','notes','settings'];
const BUILTINS = new Map(BUILTIN_ROBOTS.map(robot=>[robot.id,robot]));
const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const blank = () => ({schemaVersion:SCHEMA_VERSION,revision:0,robots:[],results:[]});

export class RegistryError extends Error {
  constructor(code,message) { super(message);this.name='RegistryError';this.code=code; }
}
const fail = (message,code='validation') => { throw new RegistryError(code,message); };

function object(value,allowed,required=[],label='Record') {
  if(!value||typeof value!=='object'||Array.isArray(value)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(label+' must be an object.');
  for(const key of Object.keys(value))if(!allowed.includes(key))fail(label+' contains an unknown field: '+key+'.');
  for(const key of required)if(!Object.hasOwn(value,key))fail(label+' needs '+key+'.');
  return value;
}
function text(value,max,label,required=true,multiline=false) {
  if(typeof value!=='string')fail(label+' must be text.');
  const clean=value.trim();
  if(required&&!clean)fail('Enter '+label.toLowerCase()+'.');
  if(clean.length>max)fail(label+' is too long (maximum '+max+' characters).');
  if((multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(clean))fail(label+' contains unsupported control characters.');
  return clean;
}
function oneOf(value,options,label) { if(!options.includes(value))fail(label+' must be '+options.join(', ')+'.');return value; }
function day(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('Test date must use YYYY-MM-DD.');
  const date=new Date(value+'T00:00:00.000Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value||Number(value.slice(0,4))<1900)fail('Enter a valid test date.');
  if(value>new Date().toISOString().slice(0,10))fail('A completed test cannot have a future date.');
  return value;
}
function timestamp(value,nullable=false) {
  if(nullable&&value===null)return;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||
      !Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail('Stored timestamp is invalid.');
}
function settings(value={}) {
  object(value,['rightForceN','leftForceN','description'],[],'Settings');
  const result={};
  for(const field of ['rightForceN','leftForceN'])if(Object.hasOwn(value,field)){
    if(typeof value[field]!=='number'||!Number.isFinite(value[field])||value[field]<=0||value[field]>1_000_000)fail(field+' must be a finite positive number no greater than 1,000,000 N.');
    result[field]=value[field];
  }
  if(Object.hasOwn(value,'description'))result.description=text(value.description,1000,'Settings description',false,true);
  return result;
}
function robotFields(value) {
  object(value,ROBOT_FIELDS,['name','type','domain'],'Robot');
  return {name:text(value.name,120,'Robot name'),type:text(value.type,80,'Robot type'),
    domain:oneOf(value.domain,DOMAINS,'Domain'),notes:text(value.notes??'',3000,'Robot notes',false,true)};
}
function resultFields(value) {
  object(value,RESULT_FIELDS,['robotId','task','context','location','date','outcome','evidence'],'Result');
  return {robotId:text(value.robotId,80,'Robot ID'),task:text(value.task,160,'Task'),
    context:text(value.context,240,'Test context'),location:text(value.location,160,'Test location'),
    date:day(value.date),outcome:oneOf(value.outcome,OUTCOMES,'Outcome'),
    evidence:text(value.evidence,4000,'Evidence reference',true,true),notes:text(value.notes??'',4000,'Result notes',false,true),settings:settings(value.settings??{})};
}
function pick(value,keys) { return Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]])); }
function same(a,b) { return JSON.stringify(a)===JSON.stringify(b); }
function findRobot(data,id) { return BUILTINS.get(id)||data.robots.find(robot=>robot.id===id); }
function activeRobot(data,id) {
  const robot=findRobot(data,id);if(!robot)fail('Choose a known robot.','not_found');
  if(robot.archivedAt)fail('Restore this robot before adding, changing or reviewing its results.');
  return robot;
}
function customRobot(data,id) {
  if(BUILTINS.has(id))fail('The three original robots cannot be changed in this local register.','immutable');
  const robot=data.robots.find(row=>row.id===id);if(!robot)fail('Robot not found.','not_found');return robot;
}
function findResult(data,id) {const result=data.results.find(row=>row.id===id);if(!result)fail('Result not found.','not_found');return result;}

// Validate the whole saved document before returning anything from local storage.
function validateDocument(data) {
  object(data,['schemaVersion','revision','robots','results'],['schemaVersion','revision','robots','results'],'Saved register');
  if(data.schemaVersion!==SCHEMA_VERSION)fail('This saved register uses an unsupported version.');
  if(!Number.isSafeInteger(data.revision)||data.revision<0)fail('Stored revision is invalid.');
  if(!Array.isArray(data.robots)||data.robots.length>200||!Array.isArray(data.results)||data.results.length>2000)fail('Stored register exceeds its record limits.');
  const ids=new Set();
  for(const robot of data.robots){
    object(robot,[...ROBOT_FIELDS,'id','createdAt','updatedAt','archivedAt'],[...ROBOT_FIELDS,'id','createdAt','updatedAt','archivedAt'],'Saved robot');
    if(typeof robot.id!=='string'||!/^robot_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(robot.id)||ids.has(robot.id))fail('Stored robot ID is invalid or duplicated.');
    ids.add(robot.id);
    if(!same(robotFields(pick(robot,ROBOT_FIELDS)),pick(robot,ROBOT_FIELDS)))fail('Stored robot fields are invalid.');
    timestamp(robot.createdAt);timestamp(robot.updatedAt);timestamp(robot.archivedAt,true);
  }
  for(const result of data.results){
    object(result,[...RESULT_FIELDS,'id','domain','contentVersion','review','createdAt','updatedAt','archivedAt'],
      [...RESULT_FIELDS,'id','domain','contentVersion','review','createdAt','updatedAt','archivedAt'],'Saved result');
    if(typeof result.id!=='string'||!/^result_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(result.id)||ids.has(result.id))fail('Stored result ID is invalid or duplicated.');
    ids.add(result.id);
    if(!same(resultFields(pick(result,RESULT_FIELDS)),pick(result,RESULT_FIELDS)))fail('Stored result fields are invalid.');
    const robot=findRobot(data,result.robotId);
    if(!robot||result.domain!==robot.domain)fail('Stored result has a missing robot or mismatched domain.');
    if(!Number.isSafeInteger(result.contentVersion)||result.contentVersion<1)fail('Stored result version is invalid.');
    timestamp(result.createdAt);timestamp(result.updatedAt);timestamp(result.archivedAt,true);
    if(result.review!==null){
      object(result.review,['reviewer','note','reviewedAt','resultVersion','declaration'],['reviewer','note','reviewedAt','resultVersion','declaration'],'Saved review');
      if(text(result.review.reviewer,120,'Reviewer')!==result.review.reviewer||text(result.review.note,2000,'Review note',false,true)!==result.review.note)fail('Stored review text is invalid.');
      timestamp(result.review.reviewedAt);
      if(result.review.resultVersion!==result.contentVersion||result.review.declaration!=='user-entered')fail('Stored review does not match this result version.');
    }
  }
  return data;
}

export function createStore(storage) {
  if(arguments.length===0){try{storage=globalThis.localStorage;}catch{fail('This browser has blocked local storage. Nothing has been saved.','storage');}}
  if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')fail('Local storage is unavailable. Nothing has been saved.','storage');
  function readRaw(){try{return storage.getItem(STORAGE_KEY);}catch{fail('The browser could not read local storage. Nothing has been changed.','storage');}}
  function read(){
    const raw=readRaw();if(raw===null)return {raw,data:blank()};
    try{
      if(typeof raw!=='string'||new TextEncoder().encode(raw).length>MAX_BYTES)throw new Error();
      return {raw,data:validateDocument(JSON.parse(raw))};
    }catch(error){fail('The saved register is damaged or uses an unsupported format. It has not been overwritten. '+(error instanceof RegistryError?error.message:''),'corrupt');}
  }
  function commit(mutator){
    const {raw,data}=read();const value=mutator(data);data.revision++;
    validateDocument(data);
    const encoded=JSON.stringify(data);
    if(new TextEncoder().encode(encoded).length>MAX_BYTES)fail('This local register is full. Export a backup before making more changes.','storage');
    if(readRaw()!==raw)fail('The register changed in another tab. Reload it and try again.','conflict');
    try{storage.setItem(STORAGE_KEY,encoded);}catch{fail('The browser could not save this change. Storage may be blocked or full.','storage');}
    if(readRaw()!==encoded)fail('The browser did not confirm the saved change. Reload the register before continuing.','storage');
    return clone(value);
  }
  function id(prefix,data){
    if(!globalThis.crypto?.randomUUID)fail('This browser cannot create record IDs. Open the app on localhost or HTTPS.','storage');
    let value;
    do{value=prefix+'_'+globalThis.crypto.randomUUID();}while(data.robots.some(row=>row.id===value)||data.results.some(row=>row.id===value));
    return value;
  }
  function archive(kind,recordId,archived){return commit(data=>{
    const row=kind==='robot'?customRobot(data,recordId):findResult(data,recordId);
    row.archivedAt=archived?now():null;row.updatedAt=now();return row;
  });}
  return Object.freeze({
    load(){return clone(read().data);},
    addRobot(value){const fields=robotFields(value);return commit(data=>{
      if(data.robots.length>=200)fail('This register already contains 200 robots.');
      const time=now(),robot={id:id('robot',data),...fields,createdAt:time,updatedAt:time,archivedAt:null};data.robots.push(robot);return robot;
    });},
    updateRobot(robotId,patch){object(patch,ROBOT_FIELDS,[],'Robot changes');if(!Object.keys(patch).length)fail('Choose something to change.');return commit(data=>{
      const robot=customRobot(data,robotId);if(robot.archivedAt)fail('Restore this robot before editing it.');
      const fields=robotFields({...pick(robot,ROBOT_FIELDS),...patch});
      const linked=data.results.filter(result=>result.robotId===robotId);
      if(fields.domain!==robot.domain&&linked.length)fail('A robot with result records cannot change domain. Create another robot entry instead.');
      Object.assign(robot,fields,{updatedAt:now()});
      for(const result of linked){result.review=null;result.updatedAt=now();result.contentVersion++;}
      return robot;
    });},
    archiveRobot(robotId){return archive('robot',robotId,true);},
    restoreRobot(robotId){return archive('robot',robotId,false);},
    addResult(value){const fields=resultFields(value);return commit(data=>{
      if(data.results.length>=2000)fail('This register already contains 2,000 results.');
      const robot=activeRobot(data,fields.robotId),time=now();
      const result={id:id('result',data),...fields,domain:robot.domain,contentVersion:1,review:null,createdAt:time,updatedAt:time,archivedAt:null};data.results.push(result);return result;
    });},
    updateResult(resultId,patch){object(patch,RESULT_FIELDS,[],'Result changes');if(!Object.keys(patch).length)fail('Choose something to change.');return commit(data=>{
      const result=findResult(data,resultId);if(result.archivedAt)fail('Restore this result before editing it.');
      const fields=resultFields({...pick(result,RESULT_FIELDS),...patch});
      const robot=activeRobot(data,fields.robotId);
      Object.assign(result,fields,{domain:robot.domain,contentVersion:result.contentVersion+1,review:null,updatedAt:now()});return result;
    });},
    reviewResult(resultId,value){object(value,['reviewer','note'],['reviewer'],'Review');
      const reviewer=text(value.reviewer,120,'Reviewer'),note=text(value.note??'',2000,'Review note',false,true);
      return commit(data=>{const result=findResult(data,resultId);if(result.archivedAt)fail('Restore this result before reviewing it.');activeRobot(data,result.robotId);
        result.review={reviewer,note,reviewedAt:now(),resultVersion:result.contentVersion,declaration:'user-entered'};result.updatedAt=now();return result;
      });
    },
    unreviewResult(resultId){return commit(data=>{const result=findResult(data,resultId);result.review=null;result.updatedAt=now();return result;});},
    archiveResult(resultId){return archive('result',resultId,true);},
    restoreResult(resultId){return archive('result',resultId,false);},
    exportJSON(){return JSON.stringify(read().data,null,2)+'\n';},
  });
}
