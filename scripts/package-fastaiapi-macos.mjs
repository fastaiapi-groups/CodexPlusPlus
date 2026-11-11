// 从已构建的本地应用制作分发包；不携带开发实例的环境变量与状态。
import {cpSync,existsSync,mkdirSync,symlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
const identity = process.env.MACOS_SIGNING_IDENTITY?.trim();
const notaryProfile = process.env.MACOS_NOTARY_PROFILE?.trim();
if (!identity?.startsWith('Developer ID Application: ') || !notaryProfile) {
  throw Error('分发包需要 MACOS_SIGNING_IDENTITY（Developer ID Application）和 MACOS_NOTARY_PROFILE。');
}

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(readFileSync(path.join(root,'apps/codex-plus-manager/package.json'),'utf8')).version;
const bundle=path.join(root,'dist/local-build/Codex++.app');
const arch=execFileSync('lipo',['-archs',path.join(bundle,'Contents/MacOS/CodexPlusPlus')],{encoding:'utf8'}).trim();
const target=arch==='arm64'?'arm64':arch==='x86_64'?'x64':arch.includes('arm64')&&arch.includes('x86_64')?'universal':null;
if(!target)throw Error('无法识别安装包架构');
const directory=path.join(root,'dist/fastaiapi-release',version,`macos-${target}`);
if(existsSync(directory))throw Error(`发布目录已存在，请保留现有产物后使用新版本：${directory}`);
mkdirSync(directory,{recursive:true});
const app=path.join(directory,'Codex++.app');cpSync(bundle,app,{recursive:true,verbatimSymlinks:true});
const plist=path.join(app,'Contents/Info.plist');
try{execFileSync('/usr/libexec/PlistBuddy',['-c','Delete :LSEnvironment',plist],{stdio:'pipe'});}catch(error){if(!String(error.stderr).includes('Does Not Exist'))throw error;}
for(const key of ['CFBundleVersion','CFBundleShortVersionString'])execFileSync('/usr/libexec/PlistBuddy',['-c',`Set :${key} ${version}`,plist]);
execFileSync('codesign', ['--force', '--options', 'runtime', '--timestamp', '--sign', identity, app], {stdio:'inherit'});
execFileSync('codesign', ['--verify', '--deep', '--strict', app], {stdio:'inherit'});
symlinkSync('/Applications',path.join(directory,'Applications'));
const dmg=path.join(path.dirname(directory),`CodexPlusPlus-${version}-macos-${target}.dmg`);
execFileSync('hdiutil',['create','-volname','FastAiApi Codex++','-srcfolder',directory,'-format','UDZO',dmg],{stdio:'inherit'});
execFileSync('codesign', ['--force', '--timestamp', '--sign', identity, dmg], {stdio:'inherit'});
const submission = JSON.parse(execFileSync('xcrun', [
  'notarytool', 'submit', dmg, '--keychain-profile', notaryProfile, '--wait', '--output-format', 'json',
], {encoding:'utf8'}));
if (submission.status !== 'Accepted') {
  throw Error(`Apple 公证未通过，提交 ID：${submission.id ?? '未知'}`);
}
execFileSync('xcrun', ['stapler', 'staple', dmg], {stdio:'inherit'});
execFileSync('xcrun', ['stapler', 'validate', dmg], {stdio:'inherit'});
execFileSync('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', dmg], {stdio:'inherit'});
console.log(`已签名、公证并通过 Gatekeeper 验证的分发包：${dmg}`);
