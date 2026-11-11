// 仅显式 fixture 参数启用；不发送网络请求、不存储真实凭据或修改系统配置。
export function createAccountFixture() {
  type Panel = "newapi" | "subapi";
  let selected: Panel = "newapi";
  let authenticated: Panel | null = null;
  const panels = {newapi:{name:"TuMeiAPI",email:"",route:1,balance:12.34,model:"gpt-newapi-test",keyId:7},subapi:{name:"FastAiAPI",email:"",route:0,balance:56.78,model:"gpt-subapi-test",keyId:7}};
  const connected = new Set<Panel>();
  const configurations: Record<string,{key_id?:number;model?:string}> = {};
  const calls: {command:string;platform: string;action?: string}[]=[];
  const routes=(platform:Panel)=>({platform,platforms:[{id:"newapi",name:"TuMeiAPI",origin:"https://tumeiapi.com"},{id:"subapi",name:"FastAiAPI",origin:"https://fastaiapi.cloud"}],selected:panels[platform].route,items:(platform==="newapi"?["http://8.137.194.180:90","https://tumeiapi.com","https://newapi.fastaiapi.cloud"]:["https://fastaiapi.cloud"]).map((origin,id)=>({id,name:`路线${id+1}`,origin}))});
  const invoke=async<T,>(command: string,args: any = {}): Promise<T>=>{
    const platform=(args.platform||selected) as Panel;
    if(!(platform in panels))throw new Error("平台无效");
    const p=panels[platform],action=args.action;
    const groupId=platform==="newapi"?"default":"2";
    const textGroupId=platform==="newapi"?"text-only":"3";
    const groups=[{id:groupId,name:"default",recommended:true,rate_multiplier:1},{id:textGroupId,name:"仅文字",rate_multiplier:1}];
    if(authenticated && authenticated !== platform && action !== "routes")throw new Error("已登录当前平台，请退出登录后再选择平台。");
    calls.push({command,platform,action});
    let value:any;
    if(command==="open_external_url")value={preview:true};
    else if(command==="fastaiapi_models")value=[p.model,"gpt-image-2","minimax-h3"];
    else if(command==="fastaiapi_configure"){configurations[platform]={key_id:args.keyId,model:args.model};value={preview:true};}
    else if(command==="fastaiapi_media_tool"){
      if(action==="ensure"||action==="connect"){
        if(!p.email)throw new Error(`请先登录 ${p.name}`);
        connected.add(platform);
      }
      value={registered:connected.has(platform)};
    }
    else if(command==="fastaiapi_account"){
      const body=args.body||{};
      if(action==="routes")value=routes(platform);
      else if(action==="select_platform"){if(authenticated && authenticated !== body.platform)throw new Error("已登录当前平台，请退出登录后再选择平台。");selected=body.platform;value=routes(selected);}
      else if(action==="select_route"){p.route=body.route;value={};}
      else if(action==="test_routes")value=routes(platform).items.map(r=>({id:r.id,latency_ms:88+r.id*10,error:null}));
      else if(action==="settings")value={registration_enabled:true,email_verify_enabled:true,invitation_code_enabled:false};
      else if(action==="remembered_login")value={};
      else if(action==="forget_login"||action==="verify")value={};
      else if(action==="logout"){p.email="";authenticated=null;connected.delete(platform);value={};}
      else if(action==="login"||action==="register"){p.email=body.email;authenticated=platform;value={email:p.email,username:p.email.split("@")[0],balance:p.balance,currency:platform==="newapi"?"CNY":"USD",session_persistent:true};}
      else {
        if(!p.email)throw new Error(`请先登录 ${p.name}`);
        if(action==="me")value={email:p.email,balance:p.balance,currency:platform==="newapi"?"CNY":"USD"};
        else if(action==="keys")value={items:[{id:p.keyId,name:"Codex++ FastAiApi",group:"default",group_id:platform==="subapi"?2:null,status:"active"}]};
        else if(action==="groups")value=groups;
        else if(action==="group_model_catalogs")value={groups,catalogs:{
          [groupId]:{group:"default",models:[],model_ids:[p.model,"gpt-image-2","minimax-h3"]},
          [textGroupId]:{group:"仅文字",models:[],model_ids:[p.model]},
        }};
        else if(action==="configuration")value=configurations[platform]||{};
        else if(action==="model_pricing")value={group:"default",rate_multiplier:1,currency:"USD",models:[{model:p.model,time_pricing:false,tiers:[{label:"标准价",input:1,output:2,cache:0.1}]}]};
        else if(action==="media_status")value={state:"ready",message:`${p.name} 测试连接`,models:[p.model,"gpt-image-2","minimax-h3"],default_video_available:true};
        else if(action==="media_setup"||action==="media_manual")value={configured:true};
        else if(action==="media_test")value={message:"测试场景通过（未发起生成）",model:body.kind==="image"?"gpt-image-2":p.model};
        else if(action==="orders")value={items:[{id:42,out_trade_no:"subapi-fixture-order",trade_no:"newapi-fixture-order",amount:10,money:10,pay_amount:10,currency:"USD",status:platform==="newapi"?"success":"COMPLETED",order_type:"balance"}]};
        else if(action==="checkout_info")value={methods:{alipay:{currency:"CNY",display_name:"支付宝",available:true,single_min:1,single_max:1000,fee_rate:0}},plans:[{id:1,name:"SubAPI 测试套餐",price:20,currency:"USD",validity_days:30}],balance_disabled:false,global_min:1,global_max:1000};
        else if(action==="topup_info")value={enable_online_topup:false,enable_redemption:false};
        else if(action==="subscriptions")value=[];
        else throw new Error("测试场景未开放此操作");
      }
    } else throw new Error("测试场景未开放此命令");
    return value as T;
  };
  return {invoke,calls};
}
