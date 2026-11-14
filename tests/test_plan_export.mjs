import assert from 'node:assert/strict';
import {planDownload} from '../public/customer-state.mjs';

class Node {
  constructor(tag){this.tag=tag;this.children=[];this.events={};}
  append(...nodes){for(const node of nodes){this.children.push(node);node.parent=this;}}
  setAttribute(key,value){this[key]=value;}
  addEventListener(event,handler){this.events[event]=handler;}
  focus(){this.focused=true;}
  select(){this.selected=true;}
  click(){assert.equal(this.parent,body,'The browser download link must be attached when clicked.');this.clicked=true;}
  remove(){this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;}
}
const body=new Node('body'), timers=[], blobs=[];
const saved={document:globalThis.document,URL:globalThis.URL,setTimeout:globalThis.setTimeout};
try{
  globalThis.document={body,createElement:tag=>new Node(tag)};
  globalThis.URL={createObjectURL:blob=>{blobs.push(blob);return 'blob:test';},revokeObjectURL:href=>assert.equal(href,'blob:test')};
  globalThis.setTimeout=callback=>timers.push(callback);
  const exact='{"request":{"place":"Glass <1>","force":{"min":8.0,"max":8.0}},"plan":{"state":"PENDING_CONFIRMATION"}}\n';
  const record=JSON.parse(exact);
  const frozen=JSON.stringify(record);
  assert.notEqual(frozen+'\n',exact,'Ordinary browser serialization loses the original float spelling.');
  assert.throws(()=>planDownload(record,'example.json'),/exact plan text/);
  planDownload(exact,'example.json');
  const anchor=body.children[0];assert.equal(anchor.download,'example.json');assert.equal(anchor.clicked,true);
  assert.deepEqual(JSON.parse(await blobs[0].text()),record);
  assert.equal(await blobs[0].text(),exact,'Download must preserve the server text byte for byte.');
  timers.forEach(callback=>callback());assert.equal(body.children.length,0);
  assert.equal(JSON.stringify(record),frozen);
  console.log('The attached download link preserves the exact server export without displaying raw data.');
}finally{
  globalThis.document=saved.document;globalThis.URL=saved.URL;globalThis.setTimeout=saved.setTimeout;
}
