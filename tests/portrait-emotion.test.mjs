import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guidanceMessages,parseGuidance} from '../server.mjs';
import {portraitSelection} from '../public/portraits.mjs';
const base={interpretations:[{intent:'自然接话',confidence:50,reason:'结合上下文'},{intent:'希望确认',confidence:30,reason:'语气含糊'},{intent:'暂时不确定',confidence:20,reason:'文字有限'}],suggestions:[{label:'确认',text:'你想聊聊吗？'},{label:'回应',text:'我在听。'},{label:'问问',text:'有什么想分享的？'}]};
test('AI emotion parser whitelists labels and degrades missing or malformed emotion independently',()=>{
 for(const emotion of [undefined,null,{},'happy',{label:'joyful',confidence:90},{label:'happy',confidence:'90'},{label:'sad',confidence:101},{label:'angry',confidence:-1}]){const result=parseGuidance(JSON.stringify({...base,emotion}));assert.deepEqual(result.emotion,{label:'uncertain',confidence:0});assert.equal(result.suggestions.length,3)}
 for(const label of ['happy','sad','angry','shy','surprised','thinking','neutral','uncertain'])assert.deepEqual(parseGuidance(JSON.stringify({...base,emotion:{label,confidence:80}})).emotion,{label,confidence:80});
});
test('guidance emotion prompt targets partner latest message and addresses sarcasm and ambiguity',()=>{
 const messages=guidanceMessages({name:'测试对方'},[{role:'user',content:'我好难过'},{role:'assistant',content:'我只是在想想，不生气'}],{real:true});
 assert.match(messages[0].content,/不能将当前用户的情绪/);assert.match(messages[0].content,/讽刺和转述/);assert.match(messages[0].content,/信息不足/);
 const payload=JSON.parse(messages[1].content);assert(payload.targetMessageToAnalyze.includes('我只是在想想，不生气'));assert.equal(payload.conversation[0].speaker,'当前用户（我）');
});
test('neutral, uncertain, low confidence or unavailable sprite always use default, without keyword guesses',()=>{
 const person={portraitVersion:10,portraitEmotions:{happy:20,sad:30}};
 for(const emotion of [null,{label:'neutral',confidence:100},{label:'uncertain',confidence:100},{label:'happy',confidence:69},{label:'angry',confidence:90}])assert.deepEqual(portraitSelection(person,emotion),{emotion:'default',version:10});
 assert.deepEqual(portraitSelection(person,{label:'sad',confidence:90}),{emotion:'sad',version:30});
 assert.deepEqual(portraitSelection(person,'我好开心😊'),{emotion:'default',version:10});
});
