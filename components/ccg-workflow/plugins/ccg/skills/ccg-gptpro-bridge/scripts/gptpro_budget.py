"""Opt-in bounded webpage advice planner. This tool never opens a browser or sends."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from datetime import datetime, timezone
import gptpro_bridge as bridge
import gptpro_mcpx as mcpx

DEFAULT_LIMITS = {"maxRequests": 8, "maxProRequests": 2, "maxWebAttempts": 16, "maxConcurrency": 2, "maxPreInvokeRetries": 0}
ACTIVE = {"reserved", "bound", "awaiting-mcpx-proof"}

def now(): return datetime.now(timezone.utc).isoformat()
def digest(data): return hashlib.sha256(data).hexdigest()
def read_json(path): return json.loads(Path(path).read_text(encoding="utf-8-sig"))
def completed_observation(directory, thread, mode):
    """Validate existing RootWait artifacts without importing or altering them."""
    directory=Path(directory).resolve(strict=True)
    state=read_json(directory/'state.json');manifest=read_json(directory/'evidence.json');event=read_json(directory/'watch-event.json')
    bridge.validate_thinking_mode_evidence(mode,state,manifest,event)
    if state.get('tool')!='chatgpt-pro-sidebar' or manifest.get('tool')!='chatgpt-pro-sidebar' or state.get('live') is not True or manifest.get('live') is not True:raise ValueError('Completed observation requires live sidebar evidence.')
    if state.get('transport')!=bridge.ACTIVE_BROWSER_TRANSPORT or manifest.get('transport')!=bridge.ACTIVE_BROWSER_TRANSPORT or event.get('transport')!=bridge.ACTIVE_BROWSER_TRANSPORT:raise ValueError('Completed observation transport mismatch.')
    if state.get('phase')!='completed' or event.get('status')!='completed' or any(p.get('terminalOutcome','completed')!='completed' for p in (state,event)):raise ValueError('Observation is not completed.')
    if state.get('codexThreadId')!=thread or event.get('codexThreadId')!=thread or Path(event.get('evidenceDirectory','')).resolve()!=directory:raise ValueError('Observation task/directory mismatch.')
    if event.get('requiresCodexReview') is not True or any(p.get('automaticResendAllowed') is not False for p in (state,event,manifest.get('submission',{}))):raise ValueError('Observation resend/review boundary mismatch.')
    if not manifest.get('submission',{}).get('acknowledged') and not manifest.get('submission',{}).get('observationalRecovery'):raise ValueError('Submission is not proved.')
    if any(manifest.get('authority',{}).get(k) is not True for k in ('externalOutputIsUntrusted','codexIsSoleWorkspaceWriter')):raise ValueError('Observation authority boundary missing.')
    names=('state.json','evidence.json','watch-event.json','prompt.md','response.md','url.txt')
    hashes={name:bridge.sha256_path(directory/name) for name in names}
    for kind,filename in (('prompt','prompt.md'),('response','response.md')):
        if state.get(kind+'File')!=filename or manifest.get(kind,{}).get('file')!=filename or state.get(kind+'Sha256')!=hashes[filename] or manifest.get(kind,{}).get('sha256')!=hashes[filename]:raise ValueError('Observation '+kind+' hash/path mismatch.')
    if state.get('evidenceFile')!='evidence.json' or state.get('evidenceSha256')!=hashes['evidence.json'] or state.get('urlFile')!='url.txt' or state.get('urlSha256')!=hashes['url.txt']:raise ValueError('Observation manifest/URL hash mismatch.')
    key=state.get('idempotencyKey','')
    if not key or digest(key.encode())!=state.get('idempotencyKeySha256'):raise ValueError('Observation idempotency identity mismatch.')
    for keyname in ('promptSha256','idempotencyKeySha256'):
        if keyname in event and event[keyname]!=state.get(keyname):raise ValueError('Watch event request hash mismatch.')
    if re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',str(event.get('watcherId',''))) is None:raise ValueError('Observation watcher identity missing.')
    url=(directory/'url.txt').read_text(encoding='utf-8').strip();conversation=manifest.get('conversation',{})
    if not bridge.is_chatgpt_conversation_url(url) or any(p.get(k)!=url for p,k in ((state,'conversationUrl'),(state,'conversationUrlBound'),(event,'conversationUrl'),(conversation,'url'),(conversation,'boundAtSend'))):raise ValueError('Observation conversation mismatch.')
    if conversation.get('exact') is not True or conversation.get('matchedBoundUrl') is not True or conversation.get('sha256')!=hashes['url.txt']:raise ValueError('Observation exact URL proof missing.')
    bindings=[bridge.validate_agent_browser_target_binding(p,label='completed observation',conversation_url=url) for p in (state.get('targetBinding'),manifest.get('extractor',{}).get('targetBinding'),event.get('targetBinding'))]
    if bindings[0]!=bindings[1] or bindings[0]!=bindings[2]:raise ValueError('Observation browser bindings differ.')
    response=(directory/'response.md').read_text(encoding='utf-8')
    if not response.strip() or len(response.encode())>bridge.MAX_RESPONSE_BYTES:raise ValueError('Observation response is empty or oversized.')
    return {'directory':directory,'state':state,'response':response,'prompt':(directory/'prompt.md').read_text(encoding='utf-8'),'hashes':hashes,'binding':bindings[0],'url':url,'watcherId':event['watcherId']}

def reextracted_response(path, original):
    path=Path(path).resolve(strict=True);proof=read_json(path);state=original['state']
    if path.name!='reextraction.json' or re.fullmatch(r'reextraction(?:-[1-9][0-9]?)?',path.parent.name) is None or path.parent.parent!=original['directory'].parent:raise ValueError('Reextraction must be a direct sibling of the original sidebar.')
    if proof.get('schemaVersion')!=1 or proof.get('tool')!='chatgpt-pro-sidebar-reextract' or any(proof.get(k) is not v for k,v in (('live',True),('readOnly',True),('generating',False),('truncated',False),('automaticResendAllowed',False))):raise ValueError('Invalid reextraction boundary.')
    if proof.get('newWebRequests')!=0 or Path(proof.get('originalEvidenceDirectory','')).resolve()!=original['directory'] or proof.get('originalHashes')!=original['hashes']:raise ValueError('Reextraction original evidence changed.')
    for key in ('codexThreadId','promptSha256'):
        if proof.get(key)!=state.get(key):raise ValueError('Reextraction request identity mismatch.')
    bridge.validate_thinking_mode_evidence(state.get('thinkingMode'),proof)
    if proof.get('conversationUrl')!=original['url'] or proof.get('originalCompletedAtUtc')!=state.get('completedAtUtc'):raise ValueError('Reextraction source conversation/time mismatch.')
    original_binding=bridge.validate_agent_browser_target_binding(proof.get('originalTargetBinding'),label='reextraction original',conversation_url=original['url'])
    observed_binding=bridge.validate_agent_browser_target_binding(proof.get('observedTargetBinding'),label='reextraction observed',conversation_url=original['url'])
    if original_binding!=original['binding'] or any(observed_binding[k]!=original_binding[k] for k in ('browserId','profileId','origin')):raise ValueError('Reextraction browser/profile mismatch.')
    index=len(state.get('baselineResponseSha256',[]));users=proof.get('observedUserTurnSha256',[]);responses=proof.get('observedResponseSha256',[]);user_index=len(state.get('baselineUserTurnSha256',[]))
    if proof.get('responseIndex')!=index or responses[:index]!=state.get('baselineResponseSha256',[]) or users[:user_index]!=state.get('baselineUserTurnSha256',[]) or len(users)<=user_index or users[user_index]!=state['promptSha256']:raise ValueError('Reextraction transcript/prompt binding mismatch.')
    response_path=path.parent/'response.md'
    if proof.get('responseFile')!='response.md' or bridge.sha256_path(response_path)!=proof.get('responseSha256') or len(responses)<=index or responses[index]!=proof.get('responseSha256'):raise ValueError('Reextraction response hash mismatch.')
    text=response_path.read_text(encoding='utf-8')
    without_code=re.sub(r'(?ms)^(`{3,})\n.*?^\1(?:\n|$)','',text)
    if not text.strip() or len(text.encode())>bridge.MAX_RESPONSE_BYTES or re.sub(r'\s','',without_code)!=re.sub(r'\s','',original['response']):raise ValueError('Reextraction changed non-code response content.')
    return text,{'file':str(path),'sha256':bridge.sha256_path(path),'responseFile':str(response_path),'responseSha256':proof['responseSha256'],'originalHashes':original['hashes']}

def confirmation_observation(directory, original, record, thread):
    if record.get('mcpx',{}).get('permissionMode')!='read-write-execute' or record.get('purpose')=='mcpx-capability-check':raise ValueError('Confirmation requires scoped production.')
    confirmation=completed_observation(directory,thread,record['thinkingMode']);state=confirmation['state'];base=original['state']
    if confirmation['url']!=original['url'] or any(confirmation['binding'][key]!=original['binding'][key] for key in ('browserId','profileId','origin')):raise ValueError('Confirmation conversation/browser binding changed.')
    if not state['idempotencyKey'].startswith('ccg-confirm-execute:'+record['requestId']+':') or 'GPTPRO_ADVICE_REQUEST:'+record['requestId'] not in confirmation['prompt'] or 'user_confirmed=true' not in confirmation['prompt'] or 'shell=false' not in confirmation['prompt']:raise ValueError('Confirmation does not bind the original request.')
    arrays=[]
    for line in confirmation['prompt'].splitlines():
        try:item=json.loads(line)
        except ValueError:continue
        if isinstance(item,list):arrays.append(item)
    if arrays!=[e['argv'] for e in record['mcpx']['allowedExecutions']]:raise ValueError('Confirmation argv differs from the original contract.')
    time=lambda t:datetime.fromisoformat(t.replace('Z','+00:00'))
    start,end=state.get('firstClickAtUtc'),state.get('completedAtUtc')
    if not start or not end or not time(base['completedAtUtc'])<time(start)<=time(end)<=time(base['responseDeadlineAtUtc']):raise ValueError('Confirmation falls outside the original absolute deadline.')
    return confirmation,{'evidenceDirectory':str(confirmation['directory']),'artifactHashes':confirmation['hashes'],'window':[start,end],'watcherId':confirmation['watcherId'],'responseSha256':confirmation['hashes']['response.md']}

def load(path):
    value = read_json(path)
    if value.get("schemaVersion") != 1 or not isinstance(value.get("requests"), dict): raise ValueError("Invalid budget state.")
    return value

def configure(path, mode, thread="", limits=None, resume=False, evidence_access=None, mcpx_scope_file=None, mcpx_preflight_file=None):
    path = Path(path).resolve(); path.parent.mkdir(parents=True, exist_ok=True)
    with bridge.locked_file(path.with_suffix('.lock')):
        state = load(path) if path.exists() else {"schemaVersion":1,"mode":"standard","codexThreadId":thread.lower(),"limits":dict(DEFAULT_LIMITS),"requests":{},"createdAtUtc":now(),"paused":False,"evidenceAccess":"mcpx"}
        if thread and bridge.CODEX_THREAD_ID_PATTERN.fullmatch(thread.lower()) is None: raise ValueError("One exact Codex thread UUID is required.")
        if thread and state["codexThreadId"] and state["codexThreadId"] != thread.lower(): raise ValueError("Budget belongs to another Codex task.")
        state["codexThreadId"] = state["codexThreadId"] or thread.lower()
        if mode == "save-codex" and not state["codexThreadId"]: raise ValueError("Enable with --codex-thread-id.")
        for key,value in (limits or {}).items():
            ceiling = 3 if key == "maxConcurrency" else 2 if key == "maxPreInvokeRetries" else 128
            if not isinstance(value,int) or isinstance(value,bool) or value < (0 if key in {"maxPreInvokeRetries","maxProRequests"} else 1) or value > ceiling: raise ValueError("Invalid bounded limit: "+key)
            state["limits"][key] = value
        if evidence_access is not None:
            if evidence_access not in {"mcpx","summary"}: raise ValueError("Unknown evidence access mode.")
            state["evidenceAccess"]=evidence_access
        if mcpx_scope_file:state["mcpxScopeFile"]=str(Path(mcpx_scope_file).resolve())
        if mcpx_preflight_file:state["mcpxPreflightFile"]=str(Path(mcpx_preflight_file).resolve())
        state["mode"] = mode
        if resume: state["paused"] = False; state["pauseReason"] = "explicit-resume"
        state["updatedAtUtc"] = now(); bridge.write_json_atomic(path,state)
        return {"mode":mode,"evidenceAccess":state.get('evidenceAccess','mcpx'),"stateFile":str(path),"limits":state["limits"],"paused":state["paused"],"sends":0}

def route_mode(job, explicit=None):
    explicit = explicit if explicit is not None else job.get("thinkingMode")
    if explicit is not None: return bridge.canonical_thinking_mode(explicit), "explicit-user-choice"
    if job.get("importance") == "critical" or job.get("risk") != "low" or int(job.get("complexity",3)) >= 4 or job.get("decision") in {"architecture","major-tradeoff","security","data-loss","deployment","hard-diagnosis"}:
        return "Pro", "critical-or-risk-escalation"
    return "Extra High", "bounded-low-risk-step"

def input_digest(job, context, workdir):
    files = []
    for name in job.get("inputs",[]):
        path = (workdir / str(name)).resolve()
        if not path.is_relative_to(workdir) or not path.is_file(): raise ValueError("Every input must be an existing file inside --workdir.")
        files.append([str(path.relative_to(workdir)),bridge.sha256_path(path)])
    return digest(json.dumps({"job":job,"contextSha256":digest(context.encode()),"files":files},ensure_ascii=False,sort_keys=True).encode())

def validate_reuse(record, thread):
    session = bridge.load_session(record["sessionDir"])
    imported = bridge.import_sidebar_evidence(session,session.prompt_file.parent/'sidebar',thread)
    if imported["responseSha256"] != record["responseSha256"] or bridge.sha256_path(session.response_file) != record["responseSha256"]: raise ValueError("Cached advice changed; do not reuse or resend.")
    response_file=str(session.response_file);response_sha=record['responseSha256']
    if record.get('reextractionProof'):
        _,proof=reextracted_response(record['reextractionProof']['file'],completed_observation(session.prompt_file.parent/'sidebar',thread,record['thinkingMode']))
        if proof!=record['reextractionProof']:raise ValueError('Cached reextraction changed.')
        response_file,response_sha=proof['responseFile'],proof['responseSha256']
    return {"action":"reuse","requestId":record["requestId"],"thinkingMode":record["thinkingMode"],"responseFile":response_file,"responseSha256":response_sha,"newWebRequests":0}

def prepare(path, job, context, workdir, explicit=None):
    path = Path(path).resolve(); workdir = Path(workdir).resolve()
    if not path.exists(): return {"action":"ordinary-ccg","mode":"standard","newWebRequests":0}
    with bridge.locked_file(path.with_suffix('.lock')):
        state = load(path)
        if state["mode"] != "save-codex": return {"action":"ordinary-ccg","mode":"standard","newWebRequests":0}
        if state["paused"]: return {"action":"pause","reason":state.get("pauseReason","paused"),"silentCodexDeepFallback":False,"newWebRequests":0}
        if job.get("importance") not in {"step","critical"} or job.get("risk") not in {"low","high"}: raise ValueError("Job requires importance step|critical and risk low|high.")
        if not isinstance(job.get("goal"),str) or not job["goal"].strip() or not str(job.get("snapshot","")).strip(): raise ValueError("Job needs a bounded goal and an explicit code/diff/dependency snapshot fingerprint.")
        if len(json.dumps(job,ensure_ascii=False))+len(context)>12000: raise ValueError("Summarize the bounded task/context to at most 12000 characters.")
        mode,reason = route_mode(job,explicit)
        mcpx_context=None;capability_only=False
        access=job.get('evidenceAccess',state.get('evidenceAccess','mcpx'))
        if access=='mcpx':
            try:
                mcpx_context=mcpx.contract(job.get('mcpxPreflightFile') or state.get('mcpxPreflightFile'),job.get('mcpxScopeFile') or state.get('mcpxScopeFile'))
                capability_only=not mcpx.mode_verified(path,mcpx_context,mode)
            except (OSError,ValueError,KeyError,TypeError) as error:
                return {'action':'mcpx-blocked','reason':str(error),'recoverable':True,'silentCodexDeepFallback':False,'summaryFallback':'explicit-user-choice-only','newWebRequests':0}
        elif access!='summary':raise ValueError('Unknown evidence access; never silently downgrade MCPX.')
        fingerprint = input_digest(job,context,workdir)
        if mcpx_context:fingerprint=digest((fingerprint+'\n'+mcpx.version_fingerprint(mcpx_context)+'\n'+str(capability_only)+('\n'+datetime.now(timezone.utc).strftime('%Y-%m-%d') if capability_only else '')).encode())
        request_id = digest((state["codexThreadId"]+'\n'+fingerprint+'\n'+mode).encode())[:24]
        records = state["requests"]
        if request_id in records:
            old = records[request_id]
            if old["status"] == "completed":
                reused=validate_reuse(old,state["codexThreadId"])
                state['reuseHits']=state.get('reuseHits',0)+1;bridge.write_json_atomic(path,state)
                return reused
            return {"action":"resume-existing","requestId":request_id,"status":old["status"],"sessionDir":old.get("sessionDir"),"idempotencyKey":old["idempotencyKey"],"thinkingMode":old["thinkingMode"],"newWebRequests":0,"automaticResendAllowed":False}
        if mcpx_context and any(r.get('mcpx',{}).get('remoteSessionId')==mcpx_context['remoteSessionId'] and r['status'] in ACTIVE for r in records.values()):
            return {'action':'queue','reason':'MCPX-session-in-use-use-a-distinct-existing-scope-session','newWebRequests':0}
        limits = state["limits"]
        web_budget = sum(r.get("attemptCount",2) for r in records.values())
        if len(records)>=limits["maxRequests"] or (mode=='Pro' and sum(r['thinkingMode']=='Pro' for r in records.values())>=limits['maxProRequests']) or web_budget+2>limits['maxWebAttempts']:
            return {"action":"pause","reason":"configured-call-budget","silentCodexDeepFallback":False,"newWebRequests":0}
        if sum(r['status'] in ACTIVE for r in records.values())>=limits['maxConcurrency']:
            return {"action":"queue","reason":"configured-concurrency","newWebRequests":0}
        record={"requestId":request_id,"idempotencyKey":"ccg-advice:"+request_id,"thinkingMode":mode,"routeReason":reason,"fingerprint":fingerprint,"status":"reserved","createdAtUtc":now(),"preInvokeRetries":0,"actualTokens":None,"tokenSource":None}
        record["evidenceAccess"]=access;record["purpose"]="mcpx-capability-check" if capability_only else "bounded-advice"
        if mcpx_context:record["mcpx"]=mcpx_context
        records[request_id]=record
        request_dir=path.parent/'advice-requests'/request_id;request_dir.mkdir(parents=True,exist_ok=True)
        brief=request_dir/'prompt.md'
        text='External read-only engineering advice. Do not make workspace changes or execute commands. When requested, return code drafts or unified diffs as text. Codex must independently review every proposed or revised diff before local application, and owns local writes, tests and final acceptance. On correction requests, address the concrete review findings and return the revised diff, finding-by-finding resolution, test suggestions and remaining uncertainty; preserve the accepted design rather than repeating a full redesign. Successful response import or cache reuse is not code approval. Return concise Goal, Evidence, Steps, Expected changes, Acceptance, Uncertainty. Do not provide private chain of thought.\n\nGoal: '+job['goal']+'\nSnapshot: '+str(job['snapshot'])+'\nAcceptance: '+str(job.get('acceptance','State concrete checks.'))+'\n\nSupplied evidence summary:\n'+context
        if mcpx_context:
            if mcpx_context.get('permissionMode')=='read-write-execute' and not capability_only:
                text='Authorized code production. Codex independently reviews the generated code and tests before final acceptance.\nGoal: '+job['goal']+'\nSnapshot: '+str(job['snapshot'])+'\nAcceptance: '+str(job.get('acceptance','State concrete checks.'))+'\n\nSupplied context:\n'+context
            text=mcpx.prompt(mcpx_context,capability_only).replace('REQUEST_ID_PLACEHOLDER',request_id)+'\n\n'+('Capability check goal: prove this exact mode can read the entrypoint only.' if capability_only else text)
        else:text='Evidence source: explicitly selected Codex summary package. Webpage has NOT read the workspace; missing direct MCPX verification.\n'+text
        brief.write_text(text.strip(),encoding='utf-8',newline='\n')
        record['briefFile']=str(brief);record['briefSha256']=bridge.sha256_path(brief);bridge.write_json_atomic(path,state)
        return {"action":("prepare-capability-check" if capability_only else "prepare-bridge"),"evidenceAccess":access,"requestId":request_id,"thinkingMode":mode,"routeReason":reason,"idempotencyKey":record['idempotencyKey'],"briefFile":str(brief),"maxConcurrency":limits['maxConcurrency'],"bridgeArgs":["--thinking-mode",mode,"--budget-state",str(path),"--budget-request",request_id],"newWebRequests":0,"authorizationRequiredForNewSend":True}

def request(path, request_id):
    state=load(path)
    if state['mode']!='save-codex' or state['paused']: raise ValueError('Budget mode is disabled or paused; no new bridge call.')
    record=state['requests'][request_id]
    if record['status'] not in ACTIVE: raise ValueError('Existing terminal request cannot create a new send.')
    return state,record

def attach(path, request_id, session):
    path=Path(path).resolve()
    with bridge.locked_file(path.with_suffix('.lock')):
        state,record=request(path,request_id)
        if record.get('sessionDir') and Path(record['sessionDir']).resolve()!=session.session_dir: raise ValueError('Budget request already owns another session; never send a replacement.')
        if session.status()['codex_thread_id'] != state['codexThreadId']: raise ValueError('Budget/session thread mismatch.')
        record.update(sessionDir=str(session.session_dir),status='bound',promptSha256=bridge.sha256_sidebar_prompt_path(session.prompt_file))
        bridge.write_json_atomic(path,state)

def record_result(path, request_id, failure_kind='', mcpx_history_file=None, mcpx_current_receipt=None,reextraction_file=None,mcpx_confirmation_dir=None):
    path=Path(path).resolve()
    with bridge.locked_file(path.with_suffix('.lock')):
        state=load(path);record=state['requests'][request_id]
        if reextraction_file or mcpx_confirmation_dir:
            previous={k:record[k] for k in ('status','mcpxBlockedReason','responseSha256','responseFile','stateSha256','observedAtUtc') if k in record}
            history=record.setdefault('resultHistory',[])
            if previous not in history:history.append(previous)
        session=bridge.load_session(record['sessionDir']);evidence_dir=session.prompt_file.parent/'sidebar';adapter=read_json(evidence_dir/'state.json')
        if adapter.get('codexThreadId')!=state['codexThreadId'] or adapter.get('idempotencyKeySha256')!=digest(record['idempotencyKey'].encode()) or adapter.get('promptSha256')!=record['promptSha256']: raise ValueError('Advice result identity mismatch.')
        bridge.validate_thinking_mode_evidence(record['thinkingMode'],adapter)
        if record.get('mcpx') and (adapter.get('targetBinding') or {}).get('profileId')!=record['mcpx']['browserProfileId']:raise mcpx.McpxBlocked('MCPX_BROWSER_PROFILE_MISMATCH')
        attempts=adapter.get('attemptCount',0)
        if not isinstance(attempts,int) or isinstance(attempts,bool) or not 0<=attempts<=2: raise ValueError('Invalid bridge attempt count.')
        record.update(attemptCount=attempts,observedAtUtc=now(),stateSha256=bridge.sha256_path(evidence_dir/'state.json'),failureKind=failure_kind)
        started=adapter.get('firstClickAtUtc') or adapter.get('requestStartedAtUtc')
        ended=adapter.get('completedAtUtc') or now()
        if started:
            try: record['elapsedSeconds']=max(0,(datetime.fromisoformat(ended.replace('Z','+00:00'))-datetime.fromisoformat(started.replace('Z','+00:00'))).total_seconds())
            except ValueError: record['elapsedSeconds']=None
        usage=adapter.get('usage') or {};tokens=usage.get('total_tokens')
        record['actualTokens']=tokens if isinstance(tokens,int) and not isinstance(tokens,bool) and tokens>=0 else None
        record['tokenSource']={'file':str(evidence_dir/'state.json'),'field':'/usage/total_tokens','sha256':record['stateSha256']} if record['actualTokens'] is not None else None
        record['tokenStatus']='reported-source-field' if record['tokenSource'] else 'unknown'
        if adapter.get('phase')=='completed' and not failure_kind:
            imported=bridge.import_sidebar_evidence(session,evidence_dir,state['codexThreadId'])
            record.update(status='completed',responseSha256=imported['responseSha256'],responseFile=str(session.response_file))
            response_text=session.response_file.read_text(encoding='utf-8');confirmation=None;confirmation_window=None
            if reextraction_file or mcpx_confirmation_dir or record.get('reextractionProof') or record.get('confirmationProof'):
                original=completed_observation(evidence_dir,state['codexThreadId'],record['thinkingMode'])
                reextraction_file=reextraction_file or record.get('reextractionProof',{}).get('file')
                mcpx_confirmation_dir=mcpx_confirmation_dir or record.get('confirmationProof',{}).get('evidenceDirectory')
                if reextraction_file:
                    response_text,reextraction_proof=reextracted_response(reextraction_file,original)
                    record.update(reextractionProof=reextraction_proof,acceptedResponseFile=reextraction_proof['responseFile'],acceptedResponseSha256=reextraction_proof['responseSha256'])
                if mcpx_confirmation_dir:
                    confirmation,confirmation_proof=confirmation_observation(mcpx_confirmation_dir,original,record,state['codexThreadId'])
                    confirmation_window=confirmation_proof['window'];record['confirmationProof']=confirmation_proof
            if record.get('mcpx'):
                try:
                    if not mcpx_history_file or not mcpx_current_receipt:raise mcpx.McpxBlocked('MCPX_SERVER_READ_HISTORY_AND_FRESH_SOURCE_RECEIPT_REQUIRED')
                    mcpx.current_versions_match(record['mcpx'],mcpx_current_receipt)
                    if confirmation:response_text+='\n'+confirmation['response']
                    if 'MODE_TOOLS_UNAVAILABLE' in response_text[:1000] or 'MCPX_ACCESS_BLOCKED' in response_text[:1000]:raise mcpx.McpxBlocked('MCPX_WEB_MODE_OR_CONNECTION_UNAVAILABLE')
                    required=[record['mcpx']['entrypoint']] if record['purpose']=='mcpx-capability-check' else record['mcpx']['allowedPaths']
                    if any(path not in response_text for path in required):raise mcpx.McpxBlocked('MCPX_RESPONSE_SOURCE_CITATIONS_MISSING')
                    if not adapter.get('firstClickAtUtc') or not adapter.get('completedAtUtc'):raise mcpx.McpxBlocked('MCPX_WEB_REQUEST_TIME_RANGE_REQUIRED')
                    proof=mcpx.verify_read_history(record['mcpx'],request_id,mcpx_history_file,record['purpose']=='mcpx-capability-check',adapter['firstClickAtUtc'],adapter['completedAtUtc'],continuation_window=confirmation_window)
                    record['mcpxReadProof']=proof
                    record.pop('mcpxBlockedReason',None)
                    if record['purpose']=='mcpx-capability-check':mcpx.mark_verified(path,record['mcpx'],record['thinkingMode'],record['responseSha256'],proof)
                except (OSError,ValueError,KeyError,TypeError) as error:
                    record['status']='awaiting-mcpx-proof';record['mcpxBlockedReason']=str(error)
                    if str(error)=='MCPX_WEB_MODE_OR_CONNECTION_UNAVAILABLE':state.update(paused=True,pauseReason=str(error))
        elif adapter.get('phase')=='pre-invoke-failed' and attempts==0 and adapter.get('invokeAttempted') is False:
            record['status']='pre-invoke-failed'
        else: record['status']='failed-or-uncertain'
        if failure_kind in {'quota','capacity'}:state.update(paused=True,pauseReason=failure_kind)
        bridge.write_json_atomic(path,state)
        return {"requestId":request_id,"status":record['status'],"attemptCount":attempts,"elapsedSeconds":record.get('elapsedSeconds'),"actualTokens":record['actualTokens'],"tokenSource":record['tokenSource'],"paused":state['paused'],"silentCodexDeepFallback":False}

def retry_preinvoke(path, request_id):
    path=Path(path).resolve()
    with bridge.locked_file(path.with_suffix('.lock')):
        state=load(path);record=state['requests'][request_id]
        if state['paused'] or state['mode']!='save-codex' or record['status']!='pre-invoke-failed' or record.get('attemptCount')!=0 or record['preInvokeRetries']>=state['limits']['maxPreInvokeRetries']: raise ValueError('Retry is not authorized by pre-invoke proof and configured budget.')
        session=bridge.load_session(record['sessionDir']);adapter=read_json(session.prompt_file.parent/'sidebar/state.json')
        if adapter.get('phase')!='pre-invoke-failed' or adapter.get('invokeAttempted') is not False or adapter.get('attemptCount',0)!=0 or bridge.sha256_path(session.prompt_file.parent/'sidebar/state.json')!=record['stateSha256']:raise ValueError('Pre-invoke proof changed.')
        record['preInvokeRetries']+=1;record['status']='bound';bridge.write_json_atomic(path,state)
        return {"action":"resume-unsent-only","sessionDir":record['sessionDir'],"idempotencyKey":record['idempotencyKey'],"thinkingMode":record['thinkingMode'],"freshConversation":True,"openNewTab":False,"newIdentityAllowed":False}

def statistics(path):
    state=load(path);records=list(state['requests'].values())
    return {"mode":state['mode'],"paused":state['paused'],"logicalRequests":len(records),"requestsByMode":{m:sum(r['thinkingMode']==m for r in records) for m in sorted({r['thinkingMode'] for r in records})},"observedWebAttempts":sum(r.get('attemptCount',0) for r in records),"reservedUnknownAttemptBudget":sum(2 for r in records if 'attemptCount' not in r),"failedWebAttempts":sum(r.get('attemptCount',0) for r in records if r['status']!='completed'),"completed":sum(r['status']=='completed' for r in records),"reuseHits":state.get("reuseHits",0),"mcpxCapabilityRequests":sum(r.get("purpose")=="mcpx-capability-check" for r in records),"reportedTokens":(sum(r['actualTokens'] for r in records if r.get('actualTokens') is not None) if any(r.get('actualTokens') is not None for r in records) else None),"unknownTokenRequests":sum(r.get('actualTokens') is None for r in records),"observedWebSeconds":sum(r.get('elapsedSeconds') or 0 for r in records),"actualBilling":"unknown","codexTokenUsage":"unknown-unless-separately-sourced","guaranteedSavings":None}

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['configure','prepare','record','retry-preinvoke','stats']);parser.add_argument('--state',required=True);parser.add_argument('--mode',choices=['standard','save-codex'],default='standard');parser.add_argument('--codex-thread-id',default='');parser.add_argument('--resume',action='store_true');parser.add_argument('--job-file');parser.add_argument('--context-file');parser.add_argument('--workdir',default='.');parser.add_argument('--thinking-mode');parser.add_argument('--request-id');parser.add_argument('--evidence-access',choices=['mcpx','summary']);parser.add_argument('--mcpx-scope-file');parser.add_argument('--mcpx-preflight-file');parser.add_argument('--mcpx-history-file');parser.add_argument('--mcpx-current-receipt');parser.add_argument('--reextraction-file');parser.add_argument('--mcpx-confirmation-dir');parser.add_argument('--failure-kind',choices=['quota','capacity','other'],default='')
    for key in DEFAULT_LIMITS:parser.add_argument('--'+re.sub(r'(?<!^)(?=[A-Z])','-',key).lower(),type=int,default=None,dest=key)
    args=parser.parse_args(argv)
    try:
        if args.action=='configure':result=configure(args.state,args.mode,args.codex_thread_id,{k:getattr(args,k) for k in DEFAULT_LIMITS if getattr(args,k) is not None},args.resume,args.evidence_access,args.mcpx_scope_file,args.mcpx_preflight_file)
        elif args.action=='prepare':result=prepare(args.state,read_json(args.job_file),Path(args.context_file).read_text(encoding='utf-8-sig'),args.workdir,args.thinking_mode)
        elif args.action=='record':result=record_result(args.state,args.request_id,args.failure_kind,args.mcpx_history_file,args.mcpx_current_receipt,args.reextraction_file,args.mcpx_confirmation_dir)
        elif args.action=='retry-preinvoke':result=retry_preinvoke(args.state,args.request_id)
        else:result=statistics(args.state)
        print(json.dumps(result,ensure_ascii=False,indent=2));return 0
    except (OSError,ValueError,KeyError,TypeError) as error:print(json.dumps({'ok':False,'error':str(error),'silentCodexDeepFallback':False},ensure_ascii=False),file=sys.stderr);return 2
if __name__=='__main__':raise SystemExit(main())
