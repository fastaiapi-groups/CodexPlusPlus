import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import Account, {FastAiApiGate} from '../../../../apps/codex-plus-manager/src/fastaiapi/Account';
import {Feedback} from '../../../../apps/codex-plus-manager/src/fastaiapi/Feedback';
import {Manual} from '../../../../apps/codex-plus-manager/src/fastaiapi/Manual';
const groups=Array.from({length:12},(_,i)=>({id:i+1,name:i===0?'gpt-pro':`分组 ${i+1} 超长名称验证`,description:'这是完整分组说明，用于确认点击问号不会切换选择。'.repeat(15)}));
(window as any).__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
 if(command==='fastaiapi_models')return Array.from({length:20},(_,i)=>i===0?'gpt-5.6-sol':`test-model-${i}`);
 if(command==='fastaiapi_configure')return {};
 if(command!=='fastaiapi_account')return {};
 switch(args.action){case 'remembered_login':return {};case 'settings':return {registration_enabled:true};case 'me':if(location.search.includes('login'))throw new Error('未登录');return {email:'ui-test@example.invalid',balance:5};case 'keys':return {items:[{id:1,name:'Codex++ FastAiApi',status:'active'},{id:2,name:'第二个测试 Key',status:'active'}]};case 'configuration':return {key_id:1,model:'gpt-5.6-sol'};case 'groups':return groups;case 'packages':return [{id:'test',name:'测试套餐',amount_cents:100,credit:'1'}];case 'orders':return [];case 'feedback':throw new Error('UI 测试：模拟网络失败，未发送真实反馈');default:return {};}
}};
function Test(){const [page,setPage]=useState('overview');return <><nav style={{display:'flex',gap:12,padding:12}}>{['overview','feedback','manual'].map(p=><button key={p} onClick={()=>setPage(p)}>{p}</button>)}</nav><main style={{padding:12}}><FastAiApiGate>{page==='overview'?<Account/>:page==='feedback'?<Feedback/>:<Manual/>}</FastAiApiGate></main></>};
createRoot(document.getElementById('root')!).render(<Test/>);
