import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {requestGate,invalidateAssessment,recordAssessment} from '../public/customer-state.mjs';
const source=fs.readFileSync(new URL('../public/customer.js',import.meta.url),'utf8');
const extract=name=>source.slice(source.indexOf('function '+name+'('),source.indexOf('\nfunction ',source.indexOf('function '+name+'(')+1));
const input={schemaVersion:3,context:{buildingId:'one',buildingName:'Office'},tasks:[],people:[],robots:[],siteChecks:{accessArranged:'PASS',siteRulesReviewed:'PASS'},review:{by:'Assessor',date:'2026-11-09',reference:'Example',decision:'UNKNOWN',scope:null}};
const gate=requestGate(),pending=gate.next();let aborted=false,cleared=false,planDisabled=false;
const state={input,reviewChoice:'PASS',pending:true,result:{old:true},error:'',gate,controller:{abort(){aborted=true;}}};
const refs={results:{replaceChildren(){cleared=true;}},error:{hidden:false},reviewError:{hidden:false}};
const context={state,refs,invalidateAssessment,recordAssessment:(value,decision)=>recordAssessment(value,decision,'2026-11-09'),updateReviewStatus(){},renderAssessmentNotice(){},renderNavigation(){planDisabled=!state.result&&!state.pending;}};
vm.createContext(context);vm.runInContext(extract('invalidate')+'\n'+extract('recordCurrentAssessment'),context);
context.recordCurrentAssessment();
assert.equal(state.input.review.decision,'PASS');assert.equal(state.input.review.by,'Assessor');assert.equal(state.input.review.date,'2026-11-09');assert.equal(state.reviewChoice,'PASS');
assert.equal(state.result,null);assert.equal(state.pending,false);assert.equal(gate.accepts(pending),false);assert.equal(aborted,true);assert.equal(cleared,true);assert.equal(planDisabled,true);
state.result={oldAssignment:true};state.reviewChoice='FAIL';context.recordCurrentAssessment();
assert.equal(state.input.review.decision,'FAIL');assert.equal(state.result,null);assert.equal(planDisabled,true,'Rejecting an assessment must remove an earlier assignment until rebuilt.');
console.log('Recording or rejecting an assessment invalidates pending answers, visible results and the Plan step.');

// Autofill may change a visible field without firing its change listener.
state.input.review={by:'',date:'',reference:'',decision:'UNKNOWN',scope:null};
refs.reviewFields={by:{value:'Autofilled assessor'},date:{value:'2026-11-09'},reference:{value:'Checked entries'}};
refs.reviewChoice={value:'PASS'};state.reviewChoice='UNKNOWN';
context.recordCurrentAssessment();
assert.equal(state.input.review.by,'Autofilled assessor');assert.equal(state.input.review.date,'2026-11-09');assert.equal(state.input.review.reference,'Checked entries');assert.equal(state.input.review.decision,'PASS');
assert.equal(state.input.review.scope.context.buildingId,'one');
// Saving text alone does not approve the assessment.
refs.reviewChoice.value='UNKNOWN';state.reviewChoice='PASS';
context.recordCurrentAssessment();
assert.equal(state.input.review.decision,'UNKNOWN');assert.equal(state.input.review.scope,null);
console.log('Assessment saving uses visible form values, and an undecided choice never becomes approval.');
