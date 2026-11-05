import {test} from "node:test";
import assert from "node:assert/strict";
import {createAccountFixture} from "../dev/account-fixture.ts";
import {configureAccount} from "./fastaiapi/onboarding.ts";
test("platform sessions and configurations survive switching without leaking data",async()=>{
  const {invoke}=createAccountFixture();
  const api=(platform:string,action:string,body?:object)=>invoke<any>("fastaiapi_account",{platform,action,body});
  await api("newapi","login",{email:"first@example.test"});
  await invoke("fastaiapi_configure",{platform:"newapi",keyId:7,model:"gpt-newapi-test"});
  await api("newapi","select_platform",{platform:"subapi"});
  await assert.rejects(api("subapi","me"),/请先登录/);
  await api("subapi","register",{email:"second@example.test"});
  assert.equal((await api("subapi","me")).balance,56.78);
  assert.deepEqual(await api("subapi","configuration"),{});
  await api("subapi","logout");
  await api("subapi","select_platform",{platform:"newapi"});
  assert.equal((await api("newapi","me")).email,"first@example.test");
  assert.equal((await api("newapi","configuration")).model,"gpt-newapi-test");
  await api("newapi","select_route",{route:2});
  assert.equal((await api("newapi","me")).email,"first@example.test");
});
test("SubAPI numeric recommended group is used when creating dedicated key",async()=>{
  let created="";
  await configureAccount([],{
    groups:async()=>[{id:"2",name:"Custom group",recommended:true}],
    createKey:async id=>{created=id;return {id:7,name:"Codex++ FastAiApi",status:"active"};},
    models:async()=>["text-model"],current:async()=>({}),apply:async()=>{},
  });
  assert.equal(created,"2");
});
