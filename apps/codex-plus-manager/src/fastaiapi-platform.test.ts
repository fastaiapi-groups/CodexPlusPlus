import {test} from "node:test";
import assert from "node:assert/strict";
import {createAccountFixture} from "../dev/account-fixture.ts";
import {configureAccount} from "./fastaiapi/onboarding.ts";
test("login and registration pin platform until logout while route switches remain available",async()=>{
  for(const action of ["login","register"]) {
    const {invoke}=createAccountFixture();
    const api=(platform:string,action:string,body?:object)=>invoke<any>("fastaiapi_account",{platform,action,body});
    await api("newapi",action,{email:"first@example.test"});
    await invoke("fastaiapi_configure",{platform:"newapi",keyId:7,model:"gpt-newapi-test"});
    await assert.rejects(api("newapi","select_platform",{platform:"subapi"}),/退出登录/);
    await assert.rejects(api("subapi","login",{email:"second@example.test"}),/退出登录/);
    await api("newapi","select_route",{route:2});
    assert.equal((await api("newapi","me")).email,"first@example.test");
    assert.equal((await api("newapi","configuration")).model,"gpt-newapi-test");
    await api("newapi","logout");
    await api("newapi","select_platform",{platform:"subapi"});
    await assert.rejects(api("subapi","me"),/请先登录/);
    await api("subapi","login",{email:"second@example.test"});
    assert.equal((await api("subapi","me")).balance,56.78);
    assert.deepEqual(await api("subapi","configuration"),{});
    await assert.rejects(api("subapi","select_platform",{platform:"newapi"}),/退出登录/);
  }
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

test("the media fixture connects automatically after account login", async () => {
  const {invoke}=createAccountFixture();
  const media=(action:string)=>invoke<{registered:boolean}>("fastaiapi_media_tool",{action,platform:"newapi"});
  assert.equal((await media("status")).registered,false);
  await invoke("fastaiapi_account",{action:"login",platform:"newapi",body:{email:"test@example.test"}});
  assert.equal((await media("ensure")).registered,true);
  assert.equal((await media("status")).registered,true);
  const catalog=await invoke<{catalogs:Record<string,{model_ids:string[]}>}>("fastaiapi_account",{action:"group_model_catalogs",platform:"newapi"});
  assert.ok(catalog.catalogs.default.model_ids.includes("gpt-image-2"));
  assert.deepEqual(catalog.catalogs["text-only"].model_ids,["gpt-newapi-test"]);
});
