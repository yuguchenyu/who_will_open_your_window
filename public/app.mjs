import * as C from './core.mjs';
import {post,get,beforeLeaving} from './api.mjs';
const icons={window:'<path d="M5 21V9a7 7 0 0 1 14 0v12Z"/><path d="M12 2v19M5 13h14"/>',note:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',chat:'<path d="M21 11a8 8 0 0 1-8 8H8l-5 3V11a9 9 0 0 1 18 0Z"/><path d="M7 10h10M7 14h6"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>',spark:'<path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7Z"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',settings:'<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',heart:'<path d="M20 5c-3-3-7-1-8 1-1-2-5-4-8-1-5 5 5 13 8 15 3-2 13-10 8-15Z"/>',check:'<path d="m5 12 4 4L19 6"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.window}</svg>`;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const app=document.getElementById('app'),dialog=document.getElementById('dialog');
// s 只是服务端状态的最近一份副本 —— 唯一真相在服务端。
let s=C.freshState();
let account=null;   // 当前登录的账号 {id, username, name}
let matchingProfile=null;
let matches=[];
const ui={tab:'meet',paperTab:'in',person:'xia',modal:null,drafts:{},suggestions:{},guidance:{},guidanceError:{},intents:{},busy:'',error:'',selected:'xia',showHistory:false,replyChoice:{}};
let media={avatar:false,background:false},mediaVersion=0;
const ai={ready:false,error:''};
const date=t=>new Date(t).toLocaleDateString('zh-CN',{month:'long',day:'numeric'});
const disabled=value=>value?' disabled':'';
const avatar=(p,small=false)=>`<span class="avatar ${p.color} ${small?'small':''}">${e(p.letter)}</span>`;
const selfAvatar=()=>media.avatar&&account?`<img class="self-avatar" src="/api/media/avatar/${e(account.id)}?v=${mediaVersion}" alt="我的虚拟形象">`:`<span class="avatar">?</span>`;
const matchAvatar=p=>p.hasAvatar?`<img class="self-avatar" src="/api/media/avatar/${encodeURIComponent(p.id)}" alt="${e(p.name)}的虚拟形象">`:'<span class="avatar">?</span>';
// 服务端返回的 state 是唯一真相，整体替换，不做增量合并。
function applyState(next){s=next}
// 被顶掉或掉线时会整页跳走，先把没发出去的草稿存一份，回来再取。
const DRAFT_KEY='heart-window-drafts';
function stashDrafts(){try{sessionStorage.setItem(DRAFT_KEY,JSON.stringify(ui.drafts))}catch{}}
function restoreDrafts(){try{const raw=sessionStorage.getItem(DRAFT_KEY);if(!raw)return;ui.drafts=JSON.parse(raw)||{};sessionStorage.removeItem(DRAFT_KEY)}catch{}}
beforeLeaving(stashDrafts);
// ui 动作名 → 服务端动作。这张表就是前端能动用的全部写操作。
const SERVER_ACTIONS={
 'submit-note':(id)=>['sendNote',{personId:id,text:ui.drafts['note:'+id]||''}],
 'simulate-reply':(id)=>['startNoteReply',{noteId:id}],
 'send-chat':(id)=>['sendMessage',{personId:id,text:ui.drafts['chat:'+id]||''}],
 'submit-reply-note':(id)=>['incomingAction',{noteId:id,op:'reply',text:ui.drafts['reply:'+id]||''}],
 'save-note':(id)=>['incomingAction',{noteId:id,op:'save'}],
 'decline-note':(id)=>['incomingAction',{noteId:id,op:'decline'}],
 'block':(id)=>['blockPerson',{personId:id}],
 'save-feeling':(id)=>['recordFeeling',{personId:id,score:Number(ui.drafts.score),memo:ui.drafts.memo||''}],
 'save-review':(id)=>['review',{personId:id,intent:ui.drafts.review.intent,authorized:!!ui.drafts.review.authorized}],
 'submit-knock':(id)=>['confirmHeart',{personId:id}],
 'save-profile':()=>['saveProfile',{profile:{...ui.drafts.profile}}],
 'advance':(id)=>['advance',{days:Number(id)}],
 'save-scenario':()=>['saveScenario',{personId:ui.selected,intent:document.getElementById('demo-intent').value,authorized:document.getElementById('demo-auth').checked}],
 'inject':()=>['injectNote',{personId:ui.selected}],
 'reset':()=>['reset',{}],
};
// 每个响应都带最新的完整状态，直接换掉本地副本。
async function submit(action,id){
 const build=SERVER_ACTIONS[action];if(!build)throw new Error('不支持的操作。');
 const [type,body]=build(id);
 const data=await post('/api/action',{type,...body});
 applyState(data.state);return data.result;
}
function toast(message){const t=document.getElementById('toast');t.textContent=message;t.classList.add('show');const feedback=dialog.querySelector('[data-modal-feedback]');if(dialog.open&&feedback){feedback.textContent=message;feedback.hidden=false}clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),4500)}
function btn(label,action,id='',type='btn',blocked=false){return `<button type="button" class="${type}" data-action="${action}" data-id="${e(id)}"${disabled(blocked)}>${label}</button>`}
function nav(){return [['meet','window','遇见'],['notes','note','纸条'],['chat','chat','对话'],['me','user','我的']].map(([id,ic,label])=>`<button type="button" class="nav-btn ${ui.tab===id?'active':''}" data-action="tab" data-id="${id}" ${ui.tab===id?'aria-current="page"':''}>${icon(ic)}<span>${label}</span></button>`).join('')}
function header(){const titles={meet:'让相遇，慢一点发生',notes:'有句话，想悄悄递给你',chat:'一句一句，慢慢靠近',me:'听见自己的心意'};return `<div class="topbar"><div><div class="date">${e(date(C.clockNow(s)))} <span> / A LITTLE CLOSER</span></div><h1>${titles[ui.tab]}</h1></div><div class="top-actions"><span class="status-pill ${ai.ready?'ready':''}"><i></i>${ai.ready?'AI 服务可用':'AI 服务暂不可用'}</span><button type="button" class="circle-btn" data-action="demo" aria-label="打开 Demo 控制面板">${icon('settings')}</button></div></div>`}
function warning(){const q=quota();return `${!ai.ready?'<div class="notice"><span>AI 服务暂不可用，请稍后再试。已有资料和草稿会保留。</span></div>':''}<div class="mobile-quota"><span>今日纸条 <b>${q.notes} / 2</b></span><span>本周期轻叩 <b>${q.heart} / 1</b></span></div>`}
function quota(){return {notes:Math.max(0,2-s.notes.filter(n=>n.direction==='out'&&n.day===C.dayOf(s)).length),heart:s.confirmations.some(c=>c.cycle===C.cycleOf(s))?0:1}}
function rail(){const q=quota();return `<aside class="right-rail"><p class="rail-title">给慢热的我们 / A LITTLE NOTE</p><div class="rail-paper"><span class="eyebrow">TAKE YOUR TIME</span><h3>窗何时打开，<br>由你决定。</h3><p>不必一开口就惊艳。<br>一句真诚的问候，<br>已经是很好的开始。</p><p class="signature">—— 谁能打开你的窗</p></div><div class="quota"><div><b>${q.notes}<span class="subtle"> / 2</span></b><small>今日可递纸条</small></div><div><b>${q.heart}<span class="subtle"> / 1</span></b><small>本周期轻叩窗扉</small></div></div><div class="rail-rules"><div>${icon('note')}<span>从共同话题开始<br>不显示已读，不催促回应</span></div><div>${icon('lock')}<span>具体好感只留给自己<br>只有双向心意才揭晓</span></div><div>${icon('heart')}<span>真人推荐只展示资料<br>纸条与聊天仍是虚拟人物</span></div></div><div class="rail-service"><span class="rail-title">当前周期 ${C.cycleOf(s)+1}</span><p>七天一次，认真选择。<br>可以通过 Demo 面板推进日期。</p>${btn('打开演示控制','demo','','demo-button')}</div></aside>`}
function realMatches(){return `<div class="subhead"><h2>为你推荐</h2><small>双方标签匹配 · ${btn('刷新','refresh-matches','','link-btn')}</small></div>${matchingProfile?.status==='ready' ? (matches.length ? matches.map(p=>`<article class="person-card match-card"><div class="person-body"><div class="person-intro"><div class="person-title">${matchAvatar(p)}<div><h3>${e(p.name)}</h3><small>真实注册用户</small></div></div><span class="tag">契合度参考 ${p.score}%</span></div><div class="tags">${p.sharedTags.map(t=>`<span class="tag">${e(t)}</span>`).join('')}</div><p class="habit">${e(p.selfIntro)}</p><p class="smallprint">依据双方自述与偏好生成。当前仅展示推荐，真人纸条与聊天尚未开放。</p></div></article>`).join('') : '<div class="empty"><h3>还没有高契合推荐</h3><p>有新用户完成介绍和标签提取后，可以回来刷新。</p></div>') : `<div class="empty"><h3>${matchingProfile?'标签尚未生成':'先留下你的介绍'}</h3><p>${matchingProfile?'资料已保存；AI 连接可用时重试提取标签。':'填写自我介绍和期待的人，开始寻找双方都合适的对象。'}</p>${btn(matchingProfile?'重试提取标签':'填写匹配资料',matchingProfile?'retry-matching':'matching','','btn secondary')}</div>`}`}
function meet(){return `<section class="hero-card"><span class="eyebrow">FOR THE QUIET HEARTS</span><h2>从一句话开始，<br>让心慢慢打开。</h2><p>不知道怎样开口也没关系。<br>先看看，谁为你留了一扇窗。</p><div class="hero-window" aria-hidden="true"></div></section>${realMatches()}<div class="subhead"><h2>虚拟人物演示</h2><small>3 位 AI 演示人物</small></div>${C.PEOPLE.map(p=>{const blocked=C.isBlocked(s,p.id);return `<article class="person-card"><div class="person-banner ${p.color}"><span class="banner-caption">${e(p.interests.join(' · '))}</span></div><div class="person-body"><div class="person-intro"><div class="person-title">${avatar(p)}<div><h3>${e(p.name)}</h3><small>${p.age} 岁 · ${e(p.city)} · ${e(p.role)}</small></div></div><span class="tag">${blocked?'已屏蔽':'AI 模拟'}</span></div><div class="tags">${p.interests.map(t=>`<span class="tag">${e(t)}</span>`).join('')}</div><p class="habit">${e(p.habit)}</p><div class="topic-box"><small>${icon('window')} TA 留了一扇窗</small>${e(p.topic)}</div><div class="person-foot"><span class="subtle">${e(blocked?'你已停止与 TA 的互动':'不需要完美开场，真实就好。')}</span><div>${btn('资料','person',p.id,'link-btn')} &nbsp; ${btn(C.hasContact(s,p.id)?'继续聊聊':'递张纸条 '+icon('note'),C.hasContact(s,p.id)?'open-chat':'note',p.id,'btn small',blocked)}</div></div></div></article>`}).join('')}`}
function empty(title,body,action='meet',label='去遇见一个人'){return `<div class="empty">${icon('window')}<h3>${title}</h3><p>${body}</p>${btn(label,action==='meet'?'tab':action,action==='meet'?'meet':'','btn secondary')}</div>`}
function notes(){const tabs=[['in','收到的'],['out','递出的'],['saved','稍后再看'],['archive','已归档']];let list=s.notes.filter(n=>ui.paperTab==='archive'?n.status==='declined':ui.paperTab==='saved'?n.status==='saved':n.direction===ui.paperTab&&!['declined','saved'].includes(n.status));return `<div class="tabs">${tabs.map(([id,t])=>btn(t,'paper-tab',id,' '+(ui.paperTab===id?'active':''))).join('')}</div>${!list.length?empty('这里留给一句问候','可以去主页递出纸条，也可以在 Demo 面板模拟收到一张。','demo','模拟收到纸条'):list.slice().reverse().map(n=>{const p=C.person(n.personId),blocked=C.isBlocked(s,p.id);return `<article class="note-card"><div class="note-top"><div class="chat-heading">${avatar(p,true)}<div><b>${n.direction==='in'?'来自':'写给'} ${e(p.name)}</b><small>${date(n.at)} · AI 演示人物 ${n.demo?'· 预设来信':''}</small></div></div>${btn('查看资料','person',p.id,'link-btn')}</div><div class="topic-box"><small>从这个话题开始</small>${e(n.topic)}</div><p class="note-text">${e(n.text)}</p><span class="subtle">${blocked?'已屏蔽':({pending:n.direction==='in'?'等待你决定是否接话':'纸条已递出 · 不提供已读状态',saved:'已暂存 · 仅你可见',accepted:'已接住这张纸条',declined:'已归档 · 不通知对方'})[n.status]}</span><div class="row-actions">${n.status==='accepted'?btn('进入对话','open-chat',p.id,'btn small',blocked):n.direction==='in'&&['pending','saved'].includes(n.status)?`${btn('回张纸条','reply-note',n.id,'btn small',blocked)}${btn('稍后再看','save-note',n.id,'link-btn',blocked)}${btn('暂不接话','decline-note',n.id,'link-btn',blocked)}`:n.direction==='out'&&n.status==='pending'?btn(ui.busy===p.id?'AI 正在回应…':'让 AI 回应这张纸条','simulate-reply',n.id,'btn small secondary',blocked||!!ui.busy||!ai.ready):''}</div>${n.direction==='out'&&n.status==='pending'?'<p class="smallprint">演示专用：点击后调用真实 AI 模拟对方回应，不代表真实用户的行为。</p>':''}</article>`}).join('')}`}
function suggestions(key){const list=ui.suggestions[key];return list?`<div class="suggestions">${list.map((v,i)=>btn(`<b>${e(v.label)}</b><span>${e(v.text)}</span>`,'choose',`${key}|${i}`,'suggestion')).join('')}</div>`:''}
function compose(key,max=500,paper=false){const intent=ui.intents[key]||'自然回应';return `<textarea class="editor ${paper?'paper':''}" data-draft="${key}" id="draft-${e(key)}" maxlength="${max}" aria-label="${paper?'纸条内容':'聊天消息'}" placeholder="写下自己的话，或让拾言帮你找到表达……">${e(ui.drafts[key]||'')}</textarea><div class="editor-meta"><span>选中建议后仍可修改，不会自动发送。</span><span data-counter="${key}">${Array.from(ui.drafts[key]||'').length} / ${max}</span></div><div class="row-actions"><select class="intent-select" data-intent="${key}" aria-label="选择表达意图">${['自然回应','关心一下','轻松接话','深入了解','换个话题','礼貌拒绝'].map(t=>`<option${t===intent?' selected':''}>${t}</option>`).join('')}</select>${btn(icon('spark')+(ui.busy==='suggest:'+key?'拾言正在构思…':'拾言 · 三个建议'),'suggest',key,'btn small secondary',!ai.ready||!!ui.busy)}</div>${suggestions(key)}`}
function chat(){
 const contacts=C.PEOPLE.filter(p=>C.hasContact(s,p.id));
 if(!contacts.length)return empty('从一张纸条开始','有人接住纸条后，你们的对话会出现在这里。');
 if(!contacts.some(p=>p.id===ui.person))ui.person=contacts[0].id;
 const p=C.person(ui.person),key='chat:'+p.id,messages=s.messages[p.id];
 const latest=messages.at(-1),incoming=[...messages].reverse().find(m=>m.role==='assistant');
 const data=ui.guidance[p.id]?.messageId===incoming?.id?ui.guidance[p.id]:null;
 const waiting=!!s.pending[p.id],blocked=C.isBlocked(s,p.id);
 const sceneStyle=media.background?` style="background-image:url('/api/media/background?v=${mediaVersion}')"`:'';
 const choices=data?.suggestions||[];
 return `<div class="tabs">${contacts.map(q=>btn(e(q.name),'open-chat',q.id,ui.person===q.id?'active':'')).join('')}</div>
 <section class="vn-stage ${p.color} ${media.background?'custom-background':''}"${sceneStyle} aria-label="与${e(p.name)}的对话场景">
  <div class="vn-scene-top"><span class="vn-scene-tag">${icon('window')} AI 模拟人物 · ${e(p.name)}</span><div>${btn('心笺','feel',p.id,'vn-tool')}${btn('设置背景','appearance','','vn-tool')}${btn(ui.showHistory?'收起记录':'回看记录','toggle-history',p.id,'vn-tool')}</div></div>
  <div class="vn-character" aria-label="对方未设置形象，显示问号人"><div class="vn-hair"></div><div class="vn-face">?</div><div class="vn-body"></div></div>
  ${!waiting&&!blocked?`<div class="vn-choices" aria-label="回复选项">${[0,1,2].map(i=>choices[i]?btn(`<b>0${i+1}</b><span>${e(choices[i].text)}</span>`,'choose-guidance',p.id+'|'+i,'vn-choice '+(ui.replyChoice[p.id]===i?'selected':'')):btn(`<b>0${i+1}</b><span>${ui.busy==='guidance:'+p.id?'正在生成 AI 选项…':'点击重新生成 AI 选项'}</span>`,'guidance',p.id,'vn-choice',!ai.ready||!!ui.busy)).join('')}${btn('<b>04</b><span>自己输入想说的话</span>','custom-reply',p.id,'vn-choice custom '+(ui.replyChoice[p.id]==='custom'?'selected':''))}</div>`:''}
  <div class="vn-dialogue"><div class="vn-speaker">${e(latest?.role==='user'?'你':p.name)} <small>${latest?.role==='assistant'?'AI 模拟':'等待回应'}</small></div><p class="vn-dialogue-text">${e(latest?.content||'对话从这里开始。')}</p>${waiting?`<div class="vn-wait">${ui.busy===p.id?'对方正在回应…':'回复尚未完成。'} ${btn('重试回复','retry',p.id,'vn-inline',!ai.ready||!!ui.busy)}</div>`:guidanceInline(p.id,data)}${!blocked&&!waiting?`<div class="vn-reply"><label class="sr-only" for="draft-${e(key)}">聊天消息</label><textarea class="vn-reply-input" data-draft="${e(key)}" id="draft-${e(key)}" maxlength="500" aria-label="聊天消息" placeholder="选择上方选项，或写下自己的回答…">${e(ui.drafts[key]||'')}</textarea>${btn('发送 '+icon('arrow'),'send-chat',p.id,'btn small',!ai.ready||!!ui.busy)}</div><span class="vn-footnote">选项会先填入输入框，可修改后发送。</span>`:blocked?'<p class="vn-footnote">你已屏蔽此人物，无法继续聊天。</p>':''}</div>
 </section>
 ${ui.showHistory?`<section class="vn-history" aria-label="聊天记录"><h3>回看记录</h3><div class="messages" id="messages">${messages.map(m=>`<div class="bubble-row ${m.role==='user'?'user':''}">${m.role==='assistant'?avatar(p,true):''}<div class="bubble">${e(m.content)}</div></div>`).join('')}</div></section>`:''}
 <div class="row-actions">${btn('记下这次感受','feel',p.id,'btn secondary small')}${btn('回望 · 确认意愿','review',p.id,'link-btn')}</div>`;
}
function me(){return `<div class="row-actions profile-appearance-action">${btn('设置场景与形象','appearance','','btn secondary small')}</div><div class="account-card"><div class="feeling-top"><div class="chat-heading">${selfAvatar()}<div><h2>${e(s.profile.name)}</h2><span class="subtle">账号 ${e(account?.username||'')}</span></div></div>${btn('编辑','profile','','link-btn')}</div><p class="habit">${e(s.profile.habit)}</p><div class="topic-box"><small>${icon('window')} 我留的一扇窗</small>${e(s.profile.topic)}</div><p class="smallprint">陌生人纸条：${s.profile.allowNotes?'接收中':'已关闭'} · 数据保存在服务端，同一账号同一时间只能登录一台设备</p></div><div class="account-card"><h2>我的匹配资料</h2><p class="smallprint">${matchingProfile?.status==='ready'?'AI 标签已生成，可以参与双方匹配。':matchingProfile?'介绍已保存，等待生成标签。':'尚未填写。'}</p>${matchingProfile?`<p>${e(matchingProfile.selfIntro)}</p><div class="tags">${matchingProfile.selfTags.map(t=>`<span class="tag">${e(t)}</span>`).join('')}</div>`:''}<div class="row-actions">${btn(matchingProfile?'编辑介绍':'填写介绍','matching','','btn secondary small')}${matchingProfile?.status==='pending'?btn('重试提取标签','retry-matching','','link-btn'):''}</div></div><div class="private-banner">${icon('lock')}窗内心笺 · 具体分数仅自己可见，不发送给 AI</div><div class="subhead"><h2>回望自己的心意</h2><small>当前第 ${C.cycleOf(s)+1} 个周期</small></div>${C.PEOPLE.map(p=>{const list=s.feelings[p.id]||[],last=list.at(-1),r=s.reviews[p.id],current=r?.cycle===C.cycleOf(s);const reason=C.confirmationReason(s,p.id);return `<article class="feeling-card"><div class="feeling-top"><div class="chat-heading">${avatar(p,true)}<div>${e(p.name)}<small class="mini-label">${last?'最近记录 '+date(last.at):'尚未记录'}</small></div></div><div class="score">${last?last.score:'—'}<span>/ 100</span></div></div><p class="review-status">${r?`${current?'本周期':'上周期'}意愿：${e(C.INTENTS[r.intent])} · ${r.authorized&&current?'已授权双向揭晓':'未授权或已过期'}`:'尚未确认本周期的意愿'}</p><div class="row-actions">${btn('写心笺','feel',p.id,'btn secondary small')}${btn('回望','review',p.id,'btn secondary small')}${btn('轻叩窗扉','knock',p.id,'btn small',!!reason||!!ui.busy)}</div>${reason?`<p class="smallprint">${e(reason)}</p>`:''}</article>`}).join('')}<div class="subhead"><h2>留存的回响</h2><small>代表当时的心意</small></div>${s.confirmations.length?s.confirmations.slice().reverse().map(c=>`<article class="result-card ${c.mutual?'':'neutral'}"><span class="subtle">${e(C.person(c.personId).name)} · ${date(c.at)} · 第 ${c.cycle+1} 周期</span><h3>${c.mutual?'你的心意，有了回响。':'本次暂未确认双向心意。'}</h3><p>${c.mutual?'你们都愿意进一步了解彼此。只揭晓共同意愿，不公开双方分数。':'这条记录只对你可见。对方不会知道你曾发起确认。'}</p></article>`).join(''):'<p class="smallprint">有过确认后，结果会保存在这里。未形成双向心意，也不必急着再试。</p>'}<div class="row-actions">${btn('演示控制面板','demo','','link-btn')}${btn('退出登录','logout','','link-btn')}</div>`}
function render(){
 app.innerHTML=`<div class="layout"><aside class="sidebar"><button type="button" class="brand" data-action="tab" data-id="meet"><span class="window-mark" aria-hidden="true"></span><span><b>谁能打开<br>你的窗</b><small>AT YOUR OWN PACE</small></span></button><nav class="side-nav" aria-label="主导航">${nav()}</nav><div class="sidebar-footer"><div class="side-quote">从一句话开始，<br>等一份心意回响。</div><span class="mini-label">LOCAL DEMO · 01</span>${btn(icon('settings')+'演示控制','demo','','demo-button')}</div></aside><main class="main">${header()}${warning()}${ui.error?`<div class="error-box" role="alert">${e(ui.error)}</div>`:''}${({meet,notes,chat,me})[ui.tab]()}</main>${rail()}<nav class="bottom-nav" aria-label="移动端导航">${nav()}</nav></div>`;
 renderModal();const messages=document.getElementById('messages');if(messages)messages.scrollTop=messages.scrollHeight;
}
function openModal(type,id=''){ui.modal={type,id};ui.error='';if(type==='feel'){const last=s.feelings[id]?.at(-1);ui.drafts.score=last?.score??50;ui.drafts.memo=''}if(type==='profile'){ui.drafts.profile={...s.profile}}if(type==='matching'){ui.drafts.matching={selfIntro:matchingProfile?.selfIntro||'',desiredIntro:matchingProfile?.desiredIntro||''}}if(type==='review'){const r=s.reviews[id];ui.drafts.review={intent:r?.intent||'exploring',authorized:r?.cycle===C.cycleOf(s)?!!r.authorized:false}}renderModal();if(!dialog.open)dialog.showModal()}
function closeModal(){if(dialog.open)dialog.close();ui.modal=null}
function modalWrap(title,body){return `<div class="modal-head"><h2>${title}</h2><button type="button" class="circle-btn" data-action="close" aria-label="关闭面板">${icon('close')}</button></div><div class="modal-body"><div class="notice" data-modal-feedback role="status" hidden></div>${body}</div>`}
function renderModal(){if(!ui.modal)return;const {type,id}=ui.modal;let title='',body='';
 if(type==='person'){const p=C.person(id);title=p.name;body=`<div class="chat-heading">${avatar(p)}<div>${e(p.role)} · ${e(p.city)}<br><span class="tag">AI 模拟人物</span></div></div><p class="serif note-text">${e(p.bio)}</p><p class="habit">${e(p.habit)}</p><div class="topic-box"><small>TA 留的话题</small>${e(p.topic)}</div><div class="row-actions">${btn(C.hasContact(s,id)?'进入对话':'递张纸条',C.hasContact(s,id)?'open-chat':'note',id,'btn',C.isBlocked(s,id))}${btn(C.isBlocked(s,id)?'已屏蔽':'屏蔽此人物','block',id,'link-btn',C.isBlocked(s,id)||!!ui.busy)}${btn('举报说明','report',id,'link-btn')}</div><p class="smallprint">本 Demo 没有真人身份验证或真实举报服务。屏蔽会立即停止本地互动并撤回揭晓授权。</p>`}
 else if(type==='report'){title='本地演示中的举报';body='<p>这里的所有人物均为虚拟人物，没有真实审核团队或举报投递服务。</p><p class="smallprint">如生成内容让你不舒服，可以屏蔽此人物，立即停止后续互动。</p>'+btn('屏蔽此人物','block',id,'btn',!!ui.busy)}
 else if(type==='note'||type==='reply-note'){const n=type==='reply-note'?s.notes.find(n=>n.id===id):null,p=C.person(n?.personId||id),key=n?'reply:'+id:'note:'+id;title=n?'回张纸条':'写给'+p.name;const reason=!n?C.noteEligibility(s,id):'';body=`<div class="topic-box"><small>${n?'收到的纸条':'从 TA 留下的话题开始'}</small>${e(n?n.text:p.topic)}</div>${!ai.ready?'<p class="smallprint">AI 服务暂不可用，请稍后再试。</p>':''}${reason?`<div class="notice">${e(reason)}</div>`:''}${compose(key,100,true)}<div class="row-actions">${btn(n?'回复并开始聊天':'递出纸条 '+icon('note'),n?'submit-reply-note':'submit-note',id,'btn',!ai.ready||!!reason||!!ui.busy)}</div><p class="smallprint">纸条附带你的演示身份。每人回应前只能递出一张，不显示已读。</p>`}
 else if(type==='feel'){const p=C.person(id),list=s.feelings[id]||[];title='窗内心笺 · '+p.name;body=`<div class="private-banner">${icon('lock')}只留给自己 · 不对外公开、不发送给 AI</div><p class="smallprint">此刻，你有多愿意继续了解 TA？滑动只是草稿，保存后才会成为记录。</p><div class="score-display"><span id="score-value">${ui.drafts.score}</span> <small>/ 100</small></div><label class="field"><span>当前好感度</span><input type="range" min="0" max="100" value="${ui.drafts.score}" id="score-input"></label><label class="field"><span>留一句只给自己的话（可选）</span><textarea class="editor" maxlength="200" id="memo">${e(ui.drafts.memo)}</textarea></label>${btn('保存这次感受','save-feeling',id,'btn',!!ui.busy)}<p class="smallprint">数字不自动转换成对外意愿，也不是你必须兑现的承诺。</p>${list.length?`<div class="timeline">${list.slice(-6).reverse().map(r=>`<p>${r.score} 分${r.memo?' · '+e(r.memo):''}<small>${date(r.at)}</small></p>`).join('')}</div>`:''}`}
 else if(type==='review'){const p=C.person(id),r=ui.drafts.review;title='回望 · '+p.name;body=`<p class="smallprint">第 ${C.cycleOf(s)+1} 个周期。回看这段时间的相处，由你确认自己的意愿。</p><label class="field"><span>此刻的心意</span><select id="review-intent">${Object.entries(C.INTENTS).map(([value,label])=>`<option value="${value}"${r.intent===value?' selected':''}>${label}</option>`).join('')}</select></label><label class="check-row"><input type="checkbox" id="review-auth"${r.authorized?' checked':''}><span>允许本周期参与双向心意确认<small>只有双方都愿意进一步了解时，才揭晓共同意愿。你可以随时取消授权。</small></span></label>${btn('确认本周期意愿','save-review',id,'btn',!!ui.busy)}<p class="smallprint">私人分数始终保密。授权下一周期会过期，不自动续期。</p>`}
 else if(type==='knock'){title='轻叩窗扉';body=`<p class="serif note-text">这一次，你想更了解${e(C.person(id).name)}。</p><p class="smallprint">本周期仅一次机会。确认后即使用，无论是否形成双向心意。对方不需要也查询你；其当期已授权的积极意愿即可匹配。</p><label class="check-row"><input type="checkbox" id="knock-consent"><span>我愿意进一步了解 TA，并同意在双向时让彼此知道。</span></label>${btn('确认轻叩','submit-knock',id,'btn',!!ui.busy)}`}
 else if(type==='result'){const c=s.confirmations.find(c=>c.id===id);title=c.mutual?'回响':'轻叩窗扉';body=`<div class="result-card ${c.mutual?'':'neutral'}"><h3>${c.mutual?'你的心意，有了回响。':'本次暂未确认双向心意。'}</h3><p>${c.mutual?'你们都愿意进一步了解彼此。按舒服的节奏继续，不必急着推进关系。':'本次没有确认到双向积极意愿。对方不会收到查询通知，也不会知道你曾轻叩。'}</p></div><p class="smallprint">这里是虚拟人物的演示结果，由 Demo 面板设置，不代表 AI 真的产生情感。</p>${btn('回到我的心笺','result-done','','btn secondary')}`}
 else if(type==='profile'){const p=ui.drafts.profile;title='留一扇窗';body=`<label class="field"><span>我的名字</span><input id="profile-name" maxlength="20" value="${e(p.name)}"></label><label class="field"><span>希望对方怎样来认识你</span><textarea id="profile-habit" class="editor" maxlength="100">${e(p.habit)}</textarea></label><label class="field"><span>一个愿意聊的话题</span><textarea id="profile-topic" class="editor" maxlength="100">${e(p.topic)}</textarea></label><label class="check-row"><input type="checkbox" id="allow-notes"${p.allowNotes?' checked':''}><span>接收陌生人纸条<small>关闭后，Demo 面板也不能注入新的陌生人纸条。</small></span></label>${btn('保存这扇窗','save-profile','','btn',!!ui.busy)}`}
 else if(type==='appearance'){title='场景与形象';body=`<p class="smallprint">背景只用于你自己的对话场景。形象会展示在你的匹配资料中；以后开放真人对话时也可使用。当前三个 AI 演示人物未设置形象，会显示问号人。</p><div class="profile-media"><div><div class="profile-media-preview">${media.background?`<img src="/api/media/background?v=${mediaVersion}" alt="当前场景背景">`:'默认场景背景'}</div><label class="field"><span>上传场景背景（PNG/JPEG/WebP，最多 3 MB）</span><input type="file" data-media="background" accept="image/png,image/jpeg,image/webp" ${ui.busy?'disabled':''}></label>${media.background?btn('恢复默认背景','delete-media','background','link-btn'):''}</div><div><div class="profile-media-preview avatar-preview">${media.avatar?`<img src="/api/media/avatar/${e(account.id)}?v=${mediaVersion}" alt="我的虚拟形象">`:'?'}</div><label class="field"><span>上传我的虚拟形象（PNG/JPEG/WebP，最多 2 MB）</span><input type="file" data-media="avatar" accept="image/png,image/jpeg,image/webp" ${ui.busy?'disabled':''}></label>${media.avatar?btn('移除形象','delete-media','avatar','link-btn'):''}</div></div>`}
 else if(type==='matching'){const p=ui.drafts.matching;title='我的匹配资料';body=`<p class="smallprint">自我介绍可能展示给匹配对象；两段介绍会发送给已配置的 AI 服务提取标签。修改后会重新提取。</p><label class="field"><span>介绍一下自己（10–500 字）</span><textarea id="match-self" class="editor" maxlength="500">${e(p.selfIntro)}</textarea></label><label class="field"><span>你希望遇见怎样的人（10–500 字）</span><textarea id="match-desired" class="editor" maxlength="500">${e(p.desiredIntro)}</textarea></label><label class="check-row"><input id="match-consent" type="checkbox"><span>我同意将自我介绍展示给匹配对象，并将两段介绍发送给已配置的 AI 服务提取标签。</span></label>${btn(ui.busy?'正在保存…':'保存并提取标签','save-matching','','btn',!!ui.busy)}`}
 else if(type==='demo'){title='Demo 控制面板';body=`<div class="notice">只改变本地演示状态，不代表真实用户意愿。</div><div class="demo-block"><h3>时间与周期</h3><p>当前 ${date(C.clockNow(s))} · 第 ${C.cycleOf(s)+1} 周期 · 已推进 ${s.offsetDays} 天</p><div class="row-actions">${btn('推进 1 天','advance','1','btn secondary small',!!ui.busy)}${btn('推进 7 天','advance','7','btn secondary small',!!ui.busy)}</div><p>按模拟日期计算额度；推进到新周期后，双方需要重新确认意愿。</p></div><div class="demo-block"><h3>虚拟人物状态</h3><label class="field"><span>选择人物</span><select id="demo-person">${C.PEOPLE.map(p=>`<option value="${p.id}"${ui.selected===p.id?' selected':''}>${e(p.name)}</option>`).join('')}</select></label><label class="field"><span>当期意愿（仅供演示控制）</span><select id="demo-intent">${Object.entries(C.INTENTS).map(([v,t])=>`<option value="${v}"${s.scenarios[ui.selected].intent===v?' selected':''}>${t}</option>`).join('')}</select></label><label class="check-row"><input type="checkbox" id="demo-auth"${s.scenarios[ui.selected].authorized?' checked':''}><span>当期授权有效</span></label>${btn('保存为本周期状态','save-scenario','','btn secondary small',!!ui.busy)}<p>此设置不会展示在正常用户资料中，也不会发送给 AI。</p></div><div class="demo-block"><h3>体验收件人流程</h3><p>给所选人物注入一张明确标注的预设来信；实际回复由服务端 AI 生成。已有互动或被屏蔽的人物不能注入。</p>${btn('模拟收到纸条','inject','','btn secondary small',!!ui.busy)}</div><div class="row-actions">${btn('重置全部演示数据','reset-confirm','','link-btn danger',!!ui.busy)}</div><p class="smallprint">重置不会修改服务端 AI 配置，账号本身也会保留，只清除纸条、聊天、心笺、授权与模拟时间。</p>`}
 else if(type==='reset'){title='重置这个 Demo？';body='<p>这会清除当前账号的纸条、聊天、心笺、授权、额度和模拟时间，恢复初始虚拟人物。</p><p class="smallprint">账号本身会保留，用户名和密码都不变。也不影响 API 配置或其他文件。</p>'+btn('确认清除并重新开始','reset','','btn',!!ui.busy)}
 dialog.innerHTML=modalWrap(title,body);
}
// 启动：先问服务端"我是谁"，一次调用同时拿到账号和整份状态。
// 没登录的话 api.mjs 会直接跳登录页，不会走到这里之后的逻辑。
async function boot(){
 try{
  const data=await get('/api/me');
  account=data.user;applyState(data.state);matchingProfile=data.matchingProfile;media=data.media||media;ai.ready=!!data.aiAvailable;ai.error='';restoreDrafts();
  try{matches=(await get('/api/matches')).matches}catch{matches=[]}
 }catch(err){ai.ready=false;ai.error=err.message||'服务暂不可用，请稍后重试。'}
 render();
}
function requireAI(){if(!ai.ready)throw new Error('AI 服务暂不可用，请稍后重试。')}
function contextFor(id){return {personId:id,messages:s.messages[id].slice(-16).map(({role,content})=>({role,content})),profile:{name:s.profile.name,habit:s.profile.habit,topic:s.profile.topic}}}
async function generateReply(id){requireAI();if(ui.busy)throw new Error('请等待当前请求完成。');const pending=s.pending[id];if(!pending)return;let replied=false;ui.busy=id;ui.error='';render();try{const context=contextFor(id);if(pending.kind==='note')context.context='对方回应你主页上话题后递来的第一张纸条，请礼貌接话。';const data=await post('/api/reply',context);applyState(data.state);ui.tab='chat';ui.person=id;replied=true;toast('AI 已回应。你可以继续聊，也可以记下感受。')}catch(err){ui.error=err.message;toast(err.message)}finally{ui.busy='';render()}if(replied)await generateGuidance(id)}
async function generateGuidance(id){if(!ai.ready||ui.busy||C.isBlocked(s,id))return;const latest=[...(s.messages[id]||[])].reverse().find(m=>m.role==='assistant');if(!latest)return;ui.busy='guidance:'+id;delete ui.guidanceError[id];render();try{const data=await post('/api/guidance',{personId:id,messageId:latest.id});if(s.messages[id].some(m=>m.id===data.messageId))ui.guidance[id]=data}catch(err){ui.guidanceError[id]=err.message}finally{ui.busy='';render()}}
async function generateSuggestions(key){requireAI();if(ui.busy)throw new Error('请等待当前请求完成。');const [kind,id]=key.split(':');const n=kind==='reply'?s.notes.find(n=>n.id===id):null;const pid=n?.personId||id;if(C.isBlocked(s,pid))throw new Error('你已屏蔽这个人物。');const body=contextFor(pid);body.intent=ui.intents[key]||'自然回应';body.draft=ui.drafts[key]||'';if(kind==='note'){body.context='根据对方主页的话题，写第一张纸条。只有草稿中主动提供的偏好才可当作事实。';body.messages=[]}if(n){body.context='为收到的纸条写一句回应。';body.messages=[{role:'assistant',content:n.text}]}
 ui.busy='suggest:'+key;ui.error='';render();try{const data=await post('/api/suggestions',body);ui.suggestions[key]=data.suggestions}catch(err){ui.error=err.message;toast(err.message)}finally{ui.busy='';render()}}
async function action(action,id){
 if(action==='close'){closeModal();return}
 if(action==='tab'){closeModal();ui.tab=id;ui.error='';if(id==='meet')try{matches=(await get('/api/matches')).matches}catch{}render();if(id==='chat'&&!ui.guidance[ui.person])await generateGuidance(ui.person);return}
 if(action==='paper-tab'){ui.paperTab=id;render();return}
 if(action==='open-chat'){closeModal();ui.person=id;ui.tab='chat';ui.error='';render();const latest=[...(s.messages[id]||[])].reverse().find(m=>m.role==='assistant');if(latest&&ui.guidance[id]?.messageId!==latest.id)await generateGuidance(id);return}
 if(action==='logout'){try{await post('/api/logout',{})}catch{}location.replace('/login.html');return}
 if(['person','report','demo','note','feel','review','reply-note','profile','appearance','matching','knock'].includes(action)){if(['note','reply-note'].includes(action)&&!ai.ready){toast('AI 服务暂不可用，请稍后再试。');return}openModal(action,id);return}
 if(action==='toggle-history'){ui.showHistory=!ui.showHistory;render();return}
 if(action==='custom-reply'){ui.replyChoice[id]='custom';ui.drafts['chat:'+id]='';render();document.getElementById('draft-chat:'+id)?.focus();return}
 if(action==='delete-media'){if(ui.busy)return;ui.busy='media';try{const data=await post('/api/media',{action:'delete',kind:id});media=data.media;mediaVersion=Date.now();toast('图片已移除。')}finally{ui.busy='';render()}return}
 if(action==='refresh-matches'){matches=(await get('/api/matches')).matches;render();return}
 if(action==='save-matching'||action==='retry-matching'){
  if(ui.busy)return;
  if(action==='save-matching'&&!document.getElementById('match-consent')?.checked)throw new Error('请先确认匹配资料展示与 AI 分析。');
  ui.busy='matching';render();
  try{const data=await post(action==='save-matching'?'/api/match-profile':'/api/match-retry',action==='save-matching'?{...ui.drafts.matching,shareForMatching:true}:{});matchingProfile=data.matchingProfile;matches=(await get('/api/matches')).matches;closeModal();toast(matchingProfile?.status==='ready'?'标签已生成，推荐已更新。':'资料已保存，AI 暂不可用，可稍后重试。')}
  finally{ui.busy='';render()}
  return;
 }
 if(action==='suggest'){await generateSuggestions(id);return}
 if(action==='guidance'){await generateGuidance(id);return}
 if(action==='choose-guidance'){const split=id.lastIndexOf('|'),pid=id.slice(0,split),index=Number(id.slice(split+1));const latest=[...(s.messages[pid]||[])].reverse().find(m=>m.role==='assistant');const data=ui.guidance[pid];if(!data||data.messageId!==latest?.id||!data.suggestions[index])return;ui.replyChoice[pid]=index;ui.drafts['chat:'+pid]=data.suggestions[index].text;render();document.getElementById('draft-chat:'+pid)?.focus();return}
 if(action==='choose'){const split=id.lastIndexOf('|'),key=id.slice(0,split),index=Number(id.slice(split+1));ui.drafts[key]=ui.suggestions[key][index].text;render();document.getElementById('draft-'+key)?.focus();return}
 if(ui.busy)throw new Error('请等待当前 AI 请求结束后再操作。');

 if(action==='simulate-reply'){requireAI();const n=await submit(action,id);await generateReply(n.personId);return}
 if(action==='retry'){await generateReply(id);return}
 // 和纸条、回信两条路一样，发出去就把草稿清掉。留着的话重绘会把刚发的那句填回输入框，
 // 再点一次就重复发送；被迫退出时 stashDrafts 还会把它当成没发出去的草稿存下来。
 // 和纸条、回信两条路一样，发出去就把草稿清掉。留着的话重绘会把刚发的那句填回输入框，
 // 再点一次就重复发送；被迫退出时 stashDrafts 还会把它当成没发出去的草稿存下来。
 if(action==='send-chat'){requireAI();await submit(action,id);ui.drafts['chat:'+id]='';delete ui.replyChoice[id];delete ui.suggestions['chat:'+id];await generateReply(id);return}
 if(action==='submit-reply-note'){requireAI();const n=await submit(action,id);ui.drafts['reply:'+id]='';closeModal();ui.tab='chat';ui.person=n.personId;await generateReply(n.personId);return}
 if(action==='submit-knock'){if(!document.getElementById('knock-consent').checked)throw new Error('请先确认自己的意愿与双向揭晓授权。');const c=await submit(action,id);openModal('result',c.id);return}
 if(action==='result-done'){closeModal();ui.tab='me';return}
 if(action==='reset-confirm'){openModal('reset');return}

 // 其余全是"发一次服务端动作、再按结果调整界面"的同一种形状。
 await submit(action,id);
 if(action==='submit-note'){ui.drafts['note:'+id]='';closeModal();ui.tab='notes';ui.paperTab='out';toast('纸条已递出。可以点击演示按钮，让 AI 回应。')}
 else if(action==='save-note')toast('已暂存，仅你可见。')
 else if(action==='decline-note')toast('已归档，对方不会收到拒绝通知。')
 else if(action==='block'){closeModal();toast('已屏蔽此人物，并撤回揭晓授权。')}
 else if(action==='save-feeling'){closeModal();toast('已记入心笺，仅自己可见。')}
 else if(action==='save-review'){closeModal();toast('已保存本周期的意愿与授权。')}
 else if(action==='save-profile'){closeModal();toast('已保存你的交流习惯与话题。')}
 else if(action==='advance')toast('已推进演示日期。')
 else if(action==='save-scenario')toast('虚拟人物的本周期状态已更新。')
 else if(action==='inject'){closeModal();ui.tab='notes';ui.paperTab='in';toast('已加入一张标注为预设的演示来信。')}
 else if(action==='reset'){ui.drafts={};ui.suggestions={};ui.guidance={};ui.guidanceError={};ui.intents={};ui.error='';ui.tab='meet';ui.person='xia';ui.selected='xia';closeModal();toast('已恢复初始演示状态，AI 配置保留。')}
 render();
}
document.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(!target||target.disabled)return;action(target.dataset.action,target.dataset.id||'').catch(err=>toast(err.message))});
document.addEventListener('input',event=>{const t=event.target;if(t.dataset.draft){ui.drafts[t.dataset.draft]=t.value;document.querySelectorAll('[data-counter]').forEach(counter=>{if(counter.dataset.counter===t.dataset.draft)counter.textContent=Array.from(t.value).length+' / '+t.maxLength})}if(t.id==='score-input'){ui.drafts.score=Number(t.value);document.getElementById('score-value').textContent=t.value}if(t.id==='memo')ui.drafts.memo=t.value;const field={'profile-name':'name','profile-habit':'habit','profile-topic':'topic'}[t.id];if(field)ui.drafts.profile[field]=t.value;if(t.id==='match-self')ui.drafts.matching.selfIntro=t.value;if(t.id==='match-desired')ui.drafts.matching.desiredIntro=t.value});
document.addEventListener('change',event=>{const t=event.target;if(t.dataset.media){uploadMedia(t.dataset.media,t.files?.[0]).catch(err=>toast(err.message));return}if(t.dataset.intent)ui.intents[t.dataset.intent]=t.value;if(t.id==='review-intent')ui.drafts.review.intent=t.value;if(t.id==='review-auth')ui.drafts.review.authorized=t.checked;if(t.id==='allow-notes')ui.drafts.profile.allowNotes=t.checked;if(t.id==='demo-person'){ui.selected=t.value;renderModal()}});
dialog.addEventListener('cancel',()=>{ui.modal=null});
function guidanceInline(id,data){
 const busy=ui.busy==='guidance:'+id,error=ui.guidanceError[id];
 return `<div class="vn-guidance" aria-label="拾言对话判断"><span class="vn-guidance-title">✧ 拾言判断 <small>仅是文字推测</small></span>${busy?'<span role="status">正在理解这句话…</span>':data?`<div class="vn-intents">${data.interpretations.map(v=>`<span title="${e(v.reason)}">${e(v.intent)} <b>${v.confidence}%</b></span>`).join('')}</div>`:`<span>${e(error||'暂无判断')}</span>`}${btn(data?'重看':'重试','guidance',id,'vn-inline',!ai.ready||!!ui.busy)}</div>`;
}
async function uploadMedia(kind,file){
 if(!file||ui.busy)return;
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('只支持 PNG、JPEG 或 WebP 图片。');
 if(file.size>(kind==='avatar'?2_000_000:3_000_000))throw new Error('图片太大，请压缩后重试。');
 ui.busy='media';renderModal();
 try{
  const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败。'));reader.readAsDataURL(file)});
  const data=await post('/api/media',{action:'save',kind,data:dataUrl});
  media=data.media;mediaVersion=Date.now();toast('图片已保存。');
 }finally{ui.busy='';render()}
}
boot();
