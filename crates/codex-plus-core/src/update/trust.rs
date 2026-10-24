//! FastAiApi 自有更新清单：先验签，再解析；前端不能指定安装来源。
use base64::Engine;
use serde::Deserialize;
use super::{Release, UpdateIntegrity, safe_asset_name};

pub const PRODUCT: &str = "fastaiapi-codexplus";
pub const DOWNLOAD_PAGE: &str = "https://fastaiapi.cloud/fastaiui/downloads/codexplus";
const PUBLIC_KEY: &str = include_str!("../../../../assets/update/fastaiapi-release-public-key.txt");
#[derive(Deserialize)]
pub struct Envelope {pub manifest_base64: String,pub signature: String,pub key_id: String}
#[derive(Deserialize)]
struct Manifest {schema_version: u32,product_id: String,version: String,channel: String,release_sequence:u64,notes:String,assets:Vec<Asset>}
#[derive(Deserialize)]
struct Asset {platform:String,arch:String,name:String,url:String,size_bytes:u64,sha256:String}

pub fn owned_url(value:&str)->bool {
    let Ok(url)=reqwest::Url::parse(value) else{return false;};
    url.scheme()=="https" && url.host_str()==Some("fastaiapi.cloud") && url.port_or_known_default()==Some(443)
        && url.username().is_empty() && url.password().is_none() && url.fragment().is_none() && url.query().is_none()
}
pub fn parse(envelope:Envelope)->anyhow::Result<Release>{parse_with_key(envelope,PUBLIC_KEY)}
fn parse_with_key(envelope:Envelope,public:&str)->anyhow::Result<Release>{
    anyhow::ensure!(envelope.key_id=="fastaiapi-release-v1","更新签名密钥不受信任");
    let engine=base64::engine::general_purpose::STANDARD;
    anyhow::ensure!(envelope.manifest_base64.len()<=180_000,"更新清单过大");
    let data=engine.decode(envelope.manifest_base64)?;
    let signature=engine.decode(envelope.signature)?;
    let public=engine.decode(public.trim())?;
    ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519,&public).verify(&data,&signature)
        .map_err(|_|anyhow::anyhow!("FastAiApi 更新签名验证失败"))?;
    let manifest:Manifest=serde_json::from_slice(&data)?;
    anyhow::ensure!(manifest.schema_version==1 && manifest.product_id==PRODUCT && manifest.channel=="stable" && manifest.release_sequence>0,"更新产品或渠道不匹配");
    anyhow::ensure!(manifest.version.split('.').count()==3 && manifest.version.split('.').all(|v|!v.is_empty()&&v.bytes().all(|b|b.is_ascii_digit())&&(v=="0"||!v.starts_with('0'))),"更新版本无效");
    anyhow::ensure!(!manifest.assets.is_empty()&&manifest.assets.len()<=3,"安装包列表无效");
    let platform=if cfg!(target_os="macos"){"macos"}else if cfg!(windows){"windows"}else{"unsupported"};
    let arch=match std::env::consts::ARCH {"aarch64"=>"arm64","x86_64"=>"x64",_=>"unsupported"};
    let mut seen=std::collections::HashSet::new();
    for a in &manifest.assets {
        anyhow::ensure!(seen.insert((&a.platform,&a.arch)),"更新平台重复");
        anyhow::ensure!(matches!((a.platform.as_str(),a.arch.as_str()),("macos","universal"|"arm64"|"x64")|("windows","x64")),"更新平台无效");
        anyhow::ensure!(a.size_bytes>0&&a.size_bytes<=2*1024*1024*1024&&a.sha256.len()==64&&a.sha256.bytes().all(|c|c.is_ascii_hexdigit()&&!c.is_ascii_uppercase()),"安装包摘要或大小无效");
        anyhow::ensure!(safe_asset_name(&a.name)?==a.name && !a.name.contains("..") && a.name.bytes().all(|c|c.is_ascii_alphanumeric()||b"._-".contains(&c)),"安装包文件名无效");
        anyhow::ensure!((a.platform=="macos"&&a.name.ends_with(".dmg"))||(a.platform=="windows"&&(a.name.ends_with(".exe")||a.name.ends_with(".msi"))),"安装包格式不匹配");
        let expected=format!("https://fastaiapi.cloud/fastaiapi/downloads/codexplus/{}/{}/{}",manifest.version,a.sha256,a.name);
        anyhow::ensure!(owned_url(&a.url)&&a.url==expected,"更新包必须来自 FastAiApi 官网");
    }
    let asset=manifest.assets.iter().find(|a|a.platform==platform&&a.arch==arch)
        .or_else(||manifest.assets.iter().find(|a|a.platform==platform&&platform=="macos"&&arch!="unsupported"&&a.arch=="universal"));
    Ok(Release {version:manifest.version,url:DOWNLOAD_PAGE.into(),body:manifest.notes,
        asset_name:asset.map(|a|a.name.clone()),asset_url:asset.map(|a|a.url.clone()),
        integrity:asset.map(|a|UpdateIntegrity{sha256:a.sha256.clone(),size_bytes:a.size_bytes,sequence:manifest.release_sequence})})
}

#[cfg(test)]
mod tests {
 use super::*;
 use ring::signature::KeyPair;
 fn signed(value:serde_json::Value)->(Envelope,String){let key=ring::signature::Ed25519KeyPair::from_seed_unchecked(&[42;32]).unwrap();let data=serde_json::to_vec(&value).unwrap();let e=base64::engine::general_purpose::STANDARD;(Envelope{manifest_base64:e.encode(&data),signature:e.encode(key.sign(&data).as_ref()),key_id:"fastaiapi-release-v1".into()},e.encode(key.public_key().as_ref()))}
 fn fixture()->serde_json::Value {let hash="a".repeat(64);serde_json::json!({"schema_version":1,"product_id":PRODUCT,"version":"1.11.3","channel":"stable","release_sequence":3,"notes":"测试","assets":[{"platform":"macos","arch":"universal","name":"CodexPlusPlus.dmg","url":format!("https://fastaiapi.cloud/fastaiapi/downloads/codexplus/1.11.3/{hash}/CodexPlusPlus.dmg"),"size_bytes":42,"sha256":hash}]})}
 #[test] fn valid_signed_manifest_and_tamper(){let(env,key)=signed(fixture());let r=parse_with_key(env,&key).unwrap();assert_eq!(r.version,"1.11.3");let(mut env,key)=signed(fixture());env.manifest_base64.push('A');assert!(parse_with_key(env,&key).is_err());}
 #[test] fn rejects_external_source_wrong_product_and_signature(){let mut v=fixture();v["assets"][0]["url"]=serde_json::json!("https://github.com/fake/pkg.dmg");let(e,k)=signed(v);assert!(parse_with_key(e,&k).is_err());let mut v=fixture();v["product_id"]=serde_json::json!("other");let(e,k)=signed(v);assert!(parse_with_key(e,&k).is_err());let(mut e,k)=signed(fixture());e.signature=base64::engine::general_purpose::STANDARD.encode([0;64]);assert!(parse_with_key(e,&k).is_err());}
 #[test] fn owned_urls_reject_credentials_queries_and_wrong_hosts(){for u in ["http://fastaiapi.cloud/pkg","https://fastaiapi.cloud.evil/pkg","https://user@fastaiapi.cloud/pkg","https://fastaiapi.cloud/pkg?url=github.com"]{assert!(!owned_url(u));}assert!(owned_url(DOWNLOAD_PAGE));}
}
