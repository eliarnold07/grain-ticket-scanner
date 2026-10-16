import { execFileSync } from 'node:child_process';
import { cp,mkdir,mkdtemp,readdir,readFile,writeFile } from 'node:fs/promises';
import { join,relative,resolve,sep } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

// Generated, source-only review artifact. Never deploys, commits or copies envs.
const base='dee3ebea570cbd14c9124066239a84472db52149';
let source=process.cwd();
const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--ref' || !/^[a-f0-9]{40}$/.test(args[1]))) {
  throw new Error('Use no arguments for an uncommitted review, or --ref followed by an exact 40-character local commit SHA.');
}
const releaseCommit=args.length?execFileSync('git',['rev-parse','--verify',`${args[1]}^{commit}`],{encoding:'utf8'}).trim():null;
const parent=join(process.env.LOCALAPPDATA||join(homedir(),'.local'),'BinFlowReleasePrep');
await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'candidate-'));
if(!resolve(root).startsWith(resolve(parent)+sep))throw new Error('Invalid generated artifact directory');
const tree=join(root,'source');await mkdir(tree);
if(releaseCommit) {
  // Read only committed blobs, never unrelated or ignored working-tree files.
  source=join(root,'committed-input');await mkdir(source);
  const inputTar=join(root,'committed-input.tar');
  execFileSync('git',['archive','--format=tar',`--output=${inputTar}`,releaseCommit]);
  execFileSync('tar',['-xf',inputTar,'-C',source]);
}
const baseTar=join(root,'base.tar');
execFileSync('git',['archive','--format=tar',`--output=${baseTar}`,base]);
execFileSync('tar',['-xf',baseTar,'-C',tree]);
for(const directory of ['server','src','scripts','test','fixtures','supabase','docs/sql']) await cp(join(source,directory),join(tree,directory),{recursive:true});
for(const file of ['package.json','package-lock.json','vite.mobile.config.js','capacitor.config.json','.node-version','.github/workflows/deploy-pages.yml']) await cp(join(source,file),join(tree,file));
// Keep develop's landing/privacy/support entries and public assets. In particular,
// never overlay unrelated untracked design concepts, native/signing files or .env.
const files=[];
async function visit(directory) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name),name=relative(tree,path).split(sep).join('/');
    if(entry.isSymbolicLink())throw new Error('Symlinks require separate artifact review');
    if(entry.isDirectory()){if(['node_modules','.git','dist','dist-mobile','ios'].includes(entry.name))throw new Error('Local/generated directory in source artifact');await visit(path);}
    else {
      if(/(^|\/)\.env(?!\.example$)/.test(name)||/credentials\.env|service-account.*\.json|\.p12$|\.mobileprovision$/i.test(name))throw new Error('Private/local file in artifact');
      const content=await readFile(path);
      const text=content.toString('utf8');
      const scanned=name==='test/mobileEnv.test.js'?text.replace(/sb_secret_fictional_[A-Za-z_]+/g,'fictional-test-key').replaceAll(['-----BEGIN','PRIVATE KEY-----fictional'].join(' '),'fictional-test-key'):text;
      if(/\b(?:sb_secret_|sk_live_|sk-proj-)[A-Za-z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(scanned))throw new Error('Credential-like content: '+name);
      for(const match of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
        let claims;try{claims=JSON.parse(Buffer.from(match[0].split('.')[1],'base64url'));}catch{}
        if(claims?.ref)throw new Error('Project API token in source artifact: '+name);
      }
      files.push({path:name,sha256:createHash('sha256').update(content).digest('hex')});
    }
  }
}
await visit(tree);files.sort((a,b)=>a.path.localeCompare(b.path));
const id=createHash('sha256').update(JSON.stringify(files)).digest('hex');
const archive=join(root,'reviewed-source.tar');execFileSync('tar',['-cf',archive,'-C',tree,'.']);
const sqlOrder=['docs/sql/proposed-farm-invitations.sql','supabase/migrations/004_inventory_estimates.sql',
  'supabase/migrations/005_grain_command_protocol.sql','docs/sql/proposed-invitation-wall-clock.sql',
  'supabase/migrations/007_application_table_grants.sql','supabase/migrations/008_release_grain_integrity.sql',
  'docs/sql/proposed-account-deletion.sql','docs/sql/proposed-saved-names.sql','docs/sql/proposed-admin-provisioning.sql',
  'supabase/migrations/009_legacy_application_privileges.sql'];
const pinnedFile=path=>{const file=files.find(file=>file.path===path);if(!file)throw new Error('Missing release file: '+path);return file;};
const manifest={format:2,baseCommit:base,iosHead:releaseCommit||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),releaseCommit,
  releaseCommitReason:releaseCommit?'Exact committed overlay on the pinned develop base; publication/deployment requires separate approval.':'Uncommitted reviewed work; separate commit/push approval required. Never deploy the old HEAD as this source.',
  sourceId:id,archiveSha256:createHash('sha256').update(await readFile(archive)).digest('hex'),files,
  runtime:{node:(await readFile(join(tree,'.node-version'),'utf8')).trim(),pagesWorkflow:pinnedFile('.github/workflows/deploy-pages.yml')},
  sql:{ordered:sqlOrder.map(pinnedFile),optionalPreservation:pinnedFile('docs/sql/proposed-preserve-empty-ownerless-farm.sql'),automaticExecution:false,
    existingBaselineFilesMustNotBeReapplied:['001_private_beta.sql','002_farm_roles.sql','003_weekly_summary_deliveries.sql']},
  requiredInitialEnvironment:{BINFLOW_WRITE_MODE:'paused',ACCOUNT_DELETION_ENABLED:'false',FARM_INVITATIONS_ENABLED:'false',BILLING_ENFORCEMENT_MODE:'disabled'},
  candidate:{entry:'server/index.js',writeMode:'operator configured; enabled only after approval'},
  maintenanceAndFallback:{entry:'server/release-rollback.js',writeMode:'forced paused; deletion/invitations/billing disabled'},
  nativeFilesIncluded:false,environmentFilesIncluded:false,compiledAssetsIncluded:false,productionDeployed:false};
await writeFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
await writeFile(join(parent,'latest.json'),JSON.stringify({directory:root,source:tree,sourceId:id,archive})+'\n');
console.log(JSON.stringify({directory:root,source:tree,sourceId:id,archiveSha256:manifest.archiveSha256,files:files.length}));
