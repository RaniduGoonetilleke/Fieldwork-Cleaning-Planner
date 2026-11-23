import {timeEstimate} from './booking-time.mjs';
export const BILL_NAMES = Object.freeze({UR3:'UR3', UR5:'UR5', G1:'G1', H1:'Robot helper', H2:'Cleaner'});
export const BILL_CURRENCIES = Object.freeze({GBP:'GBP · British pound', EUR:'EUR · Euro', USD:'USD · US dollar'});
export const BILL_SCOPE = 'Estimated robot and labour charges only. Tax, materials, travel and other extras are not included. This is not a final invoice; no payment is due from this estimate.';
export const billResources = job => job.mode === 'manual' ? [job.workerId] : [job.mode, 'H1'];
const plain = x => x && typeof x === 'object' && !Array.isArray(x) && [Object.prototype,null].includes(Object.getPrototypeOf(x));
export function normalizeBilling(job) {
 const value=job.billing;
 if(value===undefined||value===null)return null;
 if(!plain(value)||Object.keys(value).length!==2||!Object.hasOwn(value,'currency')||!Object.hasOwn(value,'rates')||typeof value.currency!=='string'||!Object.hasOwn(BILL_CURRENCIES,value.currency)||!plain(value.rates))throw new Error('Choose a currency and hourly rates for the selected team.');
 const ids=billResources(job);
 if(Object.keys(value.rates).length!==ids.length||ids.some(id=>!Object.hasOwn(value.rates,id)))throw new Error('Rates must match the selected robot and people.');
 const rates={};
 for(const id of ids){const rate=value.rates[id];if(rate!==null&&(typeof rate!=='number'||!Number.isFinite(rate)||rate<0||rate>1000000||Math.abs(rate*100-Math.round(rate*100))>1e-7))throw new Error('Hourly rates must be between 0 and 1,000,000, with at most two decimal places. Leave unknown rates blank.');rates[id]=rate===null?null:Math.round(rate*100)/100;}
 return {currency:value.currency,rates};
}
export function billEstimate(job) {
 const billing=normalizeBilling(job), time=timeEstimate(job), missing=[];
 if(!time)missing.push('Add the estimated job duration.');
 if(!billing)missing.push('Enter the company’s hourly rates.');
 const lines=billResources(job).map(id=>{
  const rate=billing?.rates[id]??null;
  if(billing&&rate===null)missing.push('Enter the hourly rate for '+BILL_NAMES[id]+'.');
  // Round each resource charge to the currency's minor unit, then add those charges.
  const cents=rate!==null&&time?Math.round(Math.round(rate*100)*time.minutes/60+1e-8):null;
  if(cents!==null&&(!Number.isSafeInteger(cents)||cents>1000000000000))throw new Error('The estimated charge is too large. Check the rates and duration.');
  return {id,name:BILL_NAMES[id],rate,minutes:time?.minutes??null,cents};
 });
 const complete=missing.length===0;
 return {currency:billing?.currency??null,minutes:time?.minutes??null,lines,missing,complete,totalCents:complete?lines.reduce((s,l)=>s+l.cents,0):null};
}
export const money=(cents,currency)=>new Intl.NumberFormat('en-GB',{style:'currency',currency}).format(cents/100);
export function billLines(job){
 const bill=billEstimate(job);const result=[];
 if(bill.minutes!==null)result.push('Company estimate: '+Number((bill.minutes/60).toPrecision(8))+' hours for each selected resource.');
 for(const line of bill.lines){result.push(line.name+': '+(line.rate===null?'hourly rate not entered':money(Math.round(line.rate*100),bill.currency)+' / hour')+'; '+(line.cents===null?'charge not calculated':money(line.cents,bill.currency))+'.');}
 result.push(bill.complete?'Estimated total ('+bill.currency+'): '+money(bill.totalCents,bill.currency):'Estimated total: incomplete. '+bill.missing.join(' '));
 return result;
}
