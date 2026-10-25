/** Two-device browser E2E with synthetic camera/audio. PHONE_PROVIDER_E2E=1 also
 * runs the actual photo, GPT Live and Lucy providers and consumes credits. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const origin = process.env.PHONE_BASE_URL ?? 'http://localhost:3026';
const output = mkdtempSync(path.join(tmpdir(), 'phone-camera-e2e-'));
const camera=process.env.MIRROR_TEST_VIDEO ?? path.join(output,'camera.y4m');
const microphone=process.env.MIRROR_TEST_AUDIO ?? path.join(output,'speech.wav');
if(!process.env.MIRROR_TEST_VIDEO) execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-loop','1','-i','public/costumes/models/cosmic-cowboy-male.webp','-t','3','-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=white','-r','15','-pix_fmt','yuv420p',camera]);
if(!process.env.MIRROR_TEST_AUDIO){const speech=path.join(output,'speech.aiff');execFileSync('say',['-o',speech,'Choose the cheapest jacket.']);execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',speech,'-af','adelay=3000,apad=whole_dur=12','-ar','48000','-ac','1',microphone]);}
const browser = await chromium.launch({headless:true, args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-video-capture=${camera}`,`--use-file-for-fake-audio-capture=${microphone}`,'--autoplay-policy=no-user-gesture-required']});
const desktopContext = await browser.newContext({viewport:{width:1440,height:1100},permissions:['camera','microphone']});
const phoneContext = await browser.newContext({viewport:{width:390,height:844},isMobile:true,permissions:['camera','microphone']});
const desktop=await desktopContext.newPage(), phone=await phoneContext.newPage();
const errors=[], checks=[];
const log=(check,data={})=>{checks.push({check,...data});console.log(JSON.stringify(checks.at(-1)));};
for(const page of [desktop,phone]) {
 page.setDefaultTimeout(20000);
 page.on('console', msg=>{if(msg.type()==='error') console.log('console-error',msg.text());});
 page.on('pageerror', error=>errors.push(error.message));
 await page.addInitScript(forceRelay=>{
  window.cameraTest={peers:[],tracks:[],requests:[],events:[],peerEvents:[]};
  const Peer=window.RTCPeerConnection;
  window.RTCPeerConnection=class extends Peer {constructor(...args){if(forceRelay && args[0]?.iceServers?.some(s=>JSON.stringify(s.urls).includes('cloudflare.com')))args[0]={...args[0],iceTransportPolicy:'relay'};super(...args);window.cameraTest.peers.push(this); const index=window.cameraTest.peers.length-1; this.addEventListener("connectionstatechange",()=>window.cameraTest.peerEvents.push({index,state:this.connectionState,at:performance.now()})); this.addEventListener("icecandidate",event=>{if(event.candidate)window.cameraTest.peerEvents.push({index,candidateType:event.candidate.type,protocol:event.candidate.protocol,at:performance.now()});});} close(){window.cameraTest.peerEvents.push({close:window.cameraTest.peers.indexOf(this),at:performance.now(),stack:new Error().stack}); return super.close();}createDataChannel(...args){const channel=super.createDataChannel(...args);channel.addEventListener('message',({data})=>{try{const event=JSON.parse(data);window.cameraTest.events.push({type:event.type,delta:event.delta});}catch{}});return channel;}};
  const replace=RTCRtpSender.prototype.replaceTrack;
  RTCRtpSender.prototype.replaceTrack=async function(track){await replace.call(this,track);if(window.cameraTest.delayNextReplace){window.cameraTest.delayNextReplace=false;await new Promise(resolve=>{window.cameraTest.releaseReplace=resolve;});}};
  const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async constraints=>{window.cameraTest.requests.push(constraints);const stream=await capture(constraints);window.cameraTest.tracks.push(...stream.getTracks());return stream;};
 },process.env.PHONE_FORCE_RELAY==='1');
}
try{
 if(process.env.MIRROR_ACCESS_URL){await desktop.goto(process.env.MIRROR_ACCESS_URL);await phone.goto(process.env.MIRROR_ACCESS_URL);}
 await desktop.goto(`${origin}/costumes/cosmic-cowboy`);
 await desktop.getByRole('tab',{name:'Try it on',exact:true}).click();
 await desktop.getByRole('button',{name:'Use phone camera',exact:true}).click();
 const link=desktop.getByRole('link',{name:'Open phone camera link'});
 await link.waitFor({timeout:20000});
 const url=await link.getAttribute('href');
 assert.equal(await desktop.evaluate(()=>window.cameraTest.requests.length),0);
 await phone.goto(url);
 await phone.getByRole('checkbox').check();
 await phone.getByRole('button',{name:'Open camera',exact:true}).click();
 await desktop.getByText('Phone camera connected',{exact:true}).waitFor({timeout:40000});
 await desktop.waitForFunction(()=>document.querySelector('video[aria-label="Phone camera preview"]')?.videoWidth>0);
 log('phone-video-on-desktop-without-desktop-camera');
 if(process.env.PHONE_FORCE_RELAY==='1') {
  const candidate=await phone.evaluate(async()=>{const stats=await window.cameraTest.peers[0].getStats();for(const stat of stats.values())if(stat.type==='transport'&&stat.selectedCandidatePairId){const pair=stats.get(stat.selectedCandidatePairId);return stats.get(pair.localCandidateId)?.candidateType;}});
  assert.equal(candidate,'relay');log('forced-turn-relay',{candidate});
 }
 const [id,token]=new URL(url).hash.slice(1).split('.');
 const base=`${origin}/api/camera-pair/${id}`;
 assert.equal((await phoneContext.request.get(base)).status(),401);
 assert.equal((await phoneContext.request.post(base,{headers:{origin,authorization:`Bearer ${token}`},data:{action:'claim',claimant:crypto.randomUUID()}})).status(),409);
 assert.equal((await phoneContext.request.post(base,{headers:{origin,authorization:`Bearer ${token}`},data:{action:'signal',description:{type:'answer',sdp:'invalid'}}})).status(),403);
 log('pairing-rejects-missing-token-second-phone-and-wrong-role');
 await desktop.screenshot({path:path.join(output,'raw-phone-preview.png')});
 assert.equal(await desktop.evaluate(()=>window.cameraTest.requests.length),0);
 await phone.getByRole('button',{name:'Take photo',exact:true}).click();
 await desktop.getByRole('img',{name:'Your photo',exact:true}).waitFor();
 await phone.getByText('Photo received on your computer. You can take another.').waitFor();
 const before=await desktop.getByRole('img',{name:'Your photo',exact:true}).getAttribute('src');
 await phone.getByRole('button',{name:'Take photo',exact:true}).click();
 await desktop.waitForFunction(src=>document.querySelector('img[alt="Your photo"]')?.src!==src,before);
 log('photo-and-retake-confirmed-by-desktop');
 await phone.getByRole('button',{name:'Switch camera',exact:true}).click();
 await phone.getByRole('button',{name:'Switch camera',exact:true}).waitFor();
 assert.equal(await phone.evaluate(()=>window.cameraTest.tracks.filter(track=>track.kind==='video'&&track.readyState==='live').length),1);
 log('camera-switch-keeps-one-live-camera');
 await desktop.screenshot({path:path.join(output,'desktop-phone-preview.png')});
 await phone.screenshot({path:path.join(output,'phone-controls.png')});
 if(process.env.PHONE_PROVIDER_E2E==='1'){
  if(process.env.PHONE_SKIP_PHOTO!=='1') {
  await desktop.getByRole('button',{name:'Try it on',exact:true}).click();
  await desktop.getByRole('img',{name:/AI preview/}).waitFor({timeout:150000});
  log('real-photo-try-on-from-phone');
  await desktop.screenshot({path:path.join(output,'photo-result.png')});
  }
  await desktop.getByRole('button',{name:'Try it on live',exact:true}).click();
  const mirror=desktop.getByRole('dialog',{name:/Costume Mirror/});
  await mirror.getByRole('checkbox').check();
  const voiceOnly=process.env.PHONE_VOICE_ONLY==='1';
  await mirror.getByRole('button',{name:voiceOnly?'Start voice styling':'Start my mirror',exact:true}).click();
  if(!voiceOnly){
  const videoDeadline=Date.now()+60000;
  let decoded=false;
  while(Date.now()<videoDeadline){
    const problem=await mirror.locator('.mirror-error').count()?await mirror.locator('.mirror-error').textContent():null;
    if(problem)throw new Error(problem);
    decoded=await desktop.evaluate(async()=>{const video=document.querySelector('video[aria-label="Live costume preview"]');if(!video?.srcObject || !video.videoWidth)return false;let streams=0;for(const peer of window.cameraTest.peers){if(peer.connectionState!=='connected')continue;for(const stat of (await peer.getStats()).values())if(stat.type==='inbound-rtp'&&stat.kind==='video'&&stat.framesDecoded>=20)streams++;}return streams===2;});
    if(decoded)break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.equal(decoded,true,'Both phone and Lucy must deliver decoded video frames.');
  }
  await desktop.waitForFunction(()=>window.cameraTest.events.some(event=>event.type==='session.started'),{}, {timeout:30000});
  assert.equal(await desktop.evaluate(()=>window.cameraTest.requests.length),0);
  const stats=await desktop.evaluate(async()=>{const result=[];for(const peer of window.cameraTest.peers)for(const stat of (await peer.getStats()).values())if(stat.type==='inbound-rtp')result.push({kind:stat.kind,framesDecoded:stat.framesDecoded,totalSamplesReceived:stat.totalSamplesReceived});return result;});
  log(voiceOnly?'real-gpt-live-uses-phone-media':'real-lucy-and-gpt-live-use-phone-media',{stats});
  assert.equal(await desktop.evaluate(()=>window.cameraTest.peers.filter(peer=>peer.connectionState==='connected').length),voiceOnly?2:3);
  await mirror.evaluate(element=>element.scrollTo(0,0));
  await desktop.screenshot({path:path.join(output,'live-result.png')});
  const cowboy=await (await desktopContext.request.get(`${origin}/api/live-mirror/catalog?slug=cosmic-cowboy`)).json();
  const jacket=cowboy.pieces.find(({piece})=>piece.id==='fringe-jacket');
  const cheap=[...jacket.options].sort((a,b)=>a.product.priceCents-b.product.priceCents)[0].product.id;
  await desktop.waitForFunction(id=>document.getElementById('mirror-piece-fringe-jacket')?.value===id,cheap,{timeout:35000});
  assert.equal(await mirror.locator('.mirror-error').count(),0);
  log('spoken-phone-command-changes-live-outfit');
  await mirror.getByRole('button',{name:'Use photo mode',exact:true}).click();
  assert.equal(await desktop.getByText('Phone camera connected',{exact:true}).isVisible(),true);
  await desktop.waitForFunction(()=>window.cameraTest.peers.filter(peer=>peer.connectionState==='connected').length===1,{}, {timeout:10000});
  await desktop.getByRole('button',{name:'Change Fringed western jacket',exact:true}).click();
  const picker=desktop.getByRole('dialog',{name:'Fringed western jacket',exact:true});
  await picker.getByRole('button').filter({hasText:jacket.options.find(option=>option.product.id!==cheap).product.title}).click();
  await picker.getByRole('button',{name:'Close',exact:true}).click();
  const stylist=desktop.getByRole('region',{name:'Photo voice styling'});
  await stylist.getByRole('checkbox').check();
  const transcripts=await desktop.evaluate(()=>window.cameraTest.events.filter(event=>event.type==='session.input_transcript.delta').length);
  await stylist.getByRole('button',{name:'Start photo voice styling'}).click();
  await desktop.waitForFunction(n=>window.cameraTest.events.filter(event=>event.type==='session.input_transcript.delta').length>n,transcripts,{timeout:30000});
  await desktop.locator('.outfit-piece').filter({has:desktop.getByRole('button',{name:'Change Fringed western jacket',exact:true})}).getByText(jacket.options.find(option=>option.product.id===cheap).product.title,{exact:true}).waitFor({timeout:20000});
  log('photo-gpt-live-reuses-phone-microphone');
  assert.equal(await desktop.evaluate(()=>window.cameraTest.requests.length),0);
  await desktop.getByRole('button',{name:'Disconnect phone',exact:true}).click();
 }else {
  await phone.evaluate(()=>{window.cameraTest.delayNextReplace=true;});
  await phone.getByRole('button',{name:'Switch camera',exact:true}).click();
  await phone.waitForFunction(()=>typeof window.cameraTest.releaseReplace==='function');
  await desktop.getByRole('button',{name:'Disconnect phone',exact:true}).click();
  await phone.getByRole('button',{name:'Open camera',exact:true}).waitFor();
  await phone.evaluate(()=>window.cameraTest.releaseReplace());
  log('disconnect-during-camera-switch');
 }
 await phone.waitForFunction(()=>window.cameraTest.tracks.every(track=>track.readyState==='ended'),{}, {timeout:15000});
 await desktop.waitForFunction(()=>window.cameraTest.peers.every(peer=>peer.connectionState==='closed'),{}, {timeout:10000});
 log('desktop-close-stops-phone-and-all-peers');
 // A used link cannot rejoin, and no camera permission is requested before validation.
 const priorRequests=await phone.evaluate(()=>window.cameraTest.requests.length);
 await phone.getByRole('button',{name:'Open camera',exact:true}).click();
 await phone.getByRole('alert').waitFor();
 assert.equal(await phone.evaluate(()=>window.cameraTest.requests.length),priorRequests);
 log('closed-link-rejected-before-camera-capture');
 assert.deepEqual(errors,[]);
 writeFileSync(path.join(output,'results.json'),JSON.stringify({checks,errors},null,2));
 console.log(`PASS ${output}`);
}catch(error){console.error(error);await desktop.screenshot({path:path.join(output,'desktop-failure.png')});await phone.screenshot({path:path.join(output,'phone-failure.png')});writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(error),checks,errors,desktopMedia:await desktop.evaluate(async()=>{const stats=[];for(const p of window.cameraTest.peers)for(const s of (await p.getStats()).values())if(s.type==='inbound-rtp')stats.push({kind:s.kind,frameWidth:s.frameWidth,frameHeight:s.frameHeight,framesDecoded:s.framesDecoded});return {peerEvents:window.cameraTest.peerEvents,events:window.cameraTest.events.slice(-20),stats,videos:[...document.querySelectorAll('video')].map(v=>({label:v.ariaLabel,width:v.videoWidth,height:v.videoHeight,paused:v.paused,ready:v.readyState}))};}),desktop:await desktop.locator('body').innerText(),phone:await phone.locator('body').innerText()},null,2));console.error(`FAIL ${output}`);process.exitCode=1;}
finally{await browser.close();}
