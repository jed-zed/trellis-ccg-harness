"""MCPX evidence contracts from successful existing tools; no network/auth/config changes."""
from __future__ import annotations
import argparse
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path,PurePosixPath
import re

READ_TOOLS = ('workspace','session','runtime_read','read')
PRODUCTION_TOOLS = READ_TOOLS + ('edit','execute','observe','progress')
class McpxBlocked(ValueError): pass

def read_json(path): return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def sha(data): return hashlib.sha256(data).hexdigest()
def relative_file(value):
    value=str(value).replace('\\','/')
    path=PurePosixPath(value)
    if not value or path.is_absolute() or ':' in value or any(x in {'..','.',''} for x in value.split('/')) or '*' in value: raise McpxBlocked('MCPX_SCOPE_PATH_INVALID')
    lower=value.lower();parts=lower.split('/')
    if any(x in {'.aws','.ssh','cookies','login data','auth.json','credentials.json','id_rsa'} or x.startswith('.env') for x in parts) or '.codex/sessions' in lower or '.codex/archived_sessions' in lower:raise McpxBlocked('MCPX_PROTECTED_OR_SECRET_PATH')
    return value

def fresh_receipt(value):
    if value.get('schemaVersion')!=1 or value.get('source')!='successful-existing-MCPX-tools':raise McpxBlocked('MCPX_CONNECTION_UNVERIFIED')
    try:age=(datetime.now(timezone.utc)-datetime.fromisoformat(value['observedAtUtc'].replace('Z','+00:00'))).total_seconds()
    except (KeyError,ValueError,TypeError):raise McpxBlocked('MCPX_PREFLIGHT_TIME_INVALID') from None
    if not -30<=age<=300:raise McpxBlocked('MCPX_PREFLIGHT_STALE_REFRESH_EXISTING_READ_TOOLS')
    if not set(READ_TOOLS).issubset(value.get('availableTools',[])) or value.get('remoteSession',{}).get('status')!='active':raise McpxBlocked('MCPX_REQUIRED_READ_TOOLS_UNAVAILABLE')
    return value

def source_records(receipt):
    rows=receipt.get('sourceFiles') or [receipt.get('successfulRead',{})]
    result={}
    for row in rows:
        path=relative_file(row.get('path',''));rev=str(row.get('revision') or row.get('rev') or '')
        hash_value=str(row.get('sha256') or row.get('instructionSha256') or '').removeprefix('sha256:')
        if hash_value and re.fullmatch('[a-fA-F0-9]{64}',hash_value) is None:raise McpxBlocked('MCPX_SOURCE_HASH_INVALID')
        if not hash_value and not rev:raise McpxBlocked('MCPX_SOURCE_VERSION_MISSING')
        if path in result:raise McpxBlocked('MCPX_DUPLICATE_SOURCE_VERSION')
        result[path]={'path':path,'revision':rev or None,'sha256':hash_value.lower() or None}
    return result

def argv_display(argv):
    def quote(arg):
        return arg if arg and re.fullmatch(r'[A-Za-z0-9_./:=+\-]+',arg) else "'"+arg.replace("'", "'\\''")+"'"
    return ' '.join(quote(arg) for arg in argv)

def working_directory_key(value):
    value = str(value)
    if re.match(r'^[A-Za-z]:[\\/]', value) or value.startswith(('\\\\', '//')):
        return value.replace('\\', '/').casefold()
    return value


def production_contract(scope,receipt,paths):
    mode=scope.get('permissionMode','read-write-execute')
    if mode=='read-only':
        if scope.get('writePaths') or scope.get('allowedExecutions'):raise McpxBlocked('MCPX_EXPLICIT_PRODUCTION_MODE_REQUIRED')
        return {}
    if mode!='read-write-execute':raise McpxBlocked('MCPX_PERMISSION_MODE_INVALID')
    if scope.get('authorizationConfirmed') is not True:raise McpxBlocked('MCPX_PRODUCTION_AUTHORIZATION_REQUIRED')
    if receipt.get('remoteSession',{}).get('role') not in {'owner','editor'} or not set(PRODUCTION_TOOLS).issubset(receipt.get('availableTools',[])):raise McpxBlocked('MCPX_PRODUCTION_TOOLS_OR_ROLE_UNAVAILABLE')
    directory=relative_file(scope.get('taskDirectory',''))
    writes=[relative_file(p) for p in scope.get('writePaths',[])]
    if not 1<=len(writes)<=20 or len(set(writes))!=len(writes) or any(',' in p for p in writes):raise McpxBlocked('MCPX_EXACT_WRITE_PATHS_REQUIRED')
    if any(not p.startswith(directory+'/') for p in paths+writes):raise McpxBlocked('MCPX_PRODUCTION_TASK_DIRECTORY_ESCAPE')
    executions=scope.get('allowedExecutions',[])
    if not isinstance(executions,list) or not 1<=len(executions)<=3:raise McpxBlocked('MCPX_EXACT_EXECUTION_REQUIRED')
    normalized=[]
    for item in executions:
        if not isinstance(item,dict):raise McpxBlocked('MCPX_BOUNDED_ARGV_SHELL_FALSE_REQUIRED')
        argv=item.get('argv',[])
        if item.get('shell') is not False or not isinstance(argv,list) or not 1<=len(argv)<=24 or any(not isinstance(a,str) or not a or len(a)>2048 or any(c in a for c in '\x00\r\n') for a in argv):raise McpxBlocked('MCPX_BOUNDED_ARGV_SHELL_FALSE_REQUIRED')
        normalized.append({'argv':argv,'shell':False,'command':argv_display(argv),'workingDirectory':receipt['workspace']['path']})
    return {'permissionMode':mode,'taskDirectory':directory,'writePaths':writes,'allowedExecutions':normalized,'allowedTools':list(PRODUCTION_TOOLS),'authorizationConfirmed':True}

def contract(preflight_file,scope_file):
    if not preflight_file or not scope_file:raise McpxBlocked('MCPX_PREFLIGHT_AND_SCOPE_REQUIRED')
    receipt=fresh_receipt(read_json(preflight_file));scope=read_json(scope_file)
    if scope.get('workspaceId')!=receipt.get('workspace',{}).get('name') or scope.get('remoteSessionId')!=receipt.get('remoteSession',{}).get('id'):raise McpxBlocked('MCPX_WORKSPACE_OR_SESSION_NOT_VERIFIED')
    paths=[relative_file(x) for x in scope.get('allowedPaths',[])]
    if not 1<=len(paths)<=20 or len(set(paths))!=len(paths):raise McpxBlocked('MCPX_SCOPE_REQUIRES_1_TO_20_EXACT_FILES')
    entry=relative_file(scope.get('entrypoint','REVIEW_ENTRYPOINT.md'))
    if entry not in paths:raise McpxBlocked('MCPX_ENTRYPOINT_OUTSIDE_SCOPE')
    profile=str(scope.get('browserProfileId','')).strip()
    if not profile:raise McpxBlocked('MCPX_BROWSER_PROFILE_NOT_BOUND')
    sources=source_records(receipt)
    if any(path not in sources for path in paths):raise McpxBlocked('MCPX_SCOPED_SOURCE_NOT_READ_IN_PREFLIGHT')
    result={'schemaVersion':1,'workspaceId':scope['workspaceId'],'remoteSessionId':scope['remoteSessionId'],'browserProfileId':profile,'workspaceRoot':receipt['workspace'].get('path'),'entrypoint':entry,'allowedPaths':paths,'filesManifest':[sources[p] for p in paths],'allowedTools':list(READ_TOOLS),'runtimeVersion':receipt.get('runtime',{}).get('version'),'observedAtUtc':receipt['observedAtUtc'],'readOnlyEnforcement':'task-tool-allowlist; server privileges unchanged','webModeCapability':'unverified-until-validated-read','preflightFile':str(Path(preflight_file).resolve()),'scopeFile':str(Path(scope_file).resolve())}
    result.update(production_contract(scope,receipt,paths))
    if result.get('permissionMode')=='read-write-execute':
        result.pop('readOnlyEnforcement')
        result['scopeEnforcement']='explicit task contract and structured-history validation; existing server owner privileges unchanged'
    return result

def version_fingerprint(value):
    fields={k:value[k] for k in ('workspaceId','browserProfileId','entrypoint','filesManifest')}
    if value.get('permissionMode')=='read-write-execute':fields.update({k:value[k] for k in ('permissionMode','taskDirectory','writePaths','allowedExecutions')})
    return sha(json.dumps(fields,sort_keys=True).encode())
def capability_key(value,mode):return sha((value['workspaceId']+'\n'+value['browserProfileId']+'\n'+value['runtimeVersion']+'\n'+mode+ ('\nread-write-execute' if value.get('permissionMode')=='read-write-execute' else '')).encode())
def registry_path(state_path):return Path(state_path).parent/'mcpx-mode-capabilities.json'
def mode_verified(state_path,value,mode):
    path=registry_path(state_path)
    if not path.exists():return False
    item=read_json(path).get('modes',{}).get(capability_key(value,mode),{})
    try:age=(datetime.now(timezone.utc)-datetime.fromisoformat(item['verifiedAtUtc'])).total_seconds()
    except (KeyError,ValueError):return False
    return 0<=age<=86400 and item.get('source')=='validated-web-import-and-MCPX-read-history' and item.get('thinkingMode')==mode

def verify_read_history(value,request_id,history_file,capability_only=False,started_at=None,completed_at=None,continuation_window=None):
    history=read_json(history_file)
    payload=history.get('data',history)
    if payload.get('next_cursor') or payload.get('truncated'):raise McpxBlocked('MCPX_HISTORY_INCOMPLETE_PAGINATE_FIRST')
    events=payload.get('events',[])
    if started_at is not None or completed_at is not None:
        try:
            lo=datetime.fromisoformat(started_at.replace('Z','+00:00'));hi=datetime.fromisoformat(completed_at.replace('Z','+00:00'))
            if hi<lo:raise ValueError('invalid range')
            stamp=lambda e:datetime.fromisoformat(e.get('created_at','').replace('Z','+00:00'))
            if continuation_window:
                if capability_only or value.get('permissionMode')!='read-write-execute':raise McpxBlocked('MCPX_CONFIRMATION_REQUIRES_PRODUCTION')
                extra_lo,extra_hi=[datetime.fromisoformat(t.replace('Z','+00:00')) for t in continuation_window]
                if not hi<extra_lo<=extra_hi:raise ValueError('invalid confirmation window')
                gap=[e for e in events if hi<stamp(e)<extra_lo and e.get('remote_session_id')==value['remoteSessionId']]
                if any(e.get('kind')=='file.changed' or (e.get('kind')=='tool.completed' and e.get('tool') in {'edit','execute'}) or (e.get('kind')=='agent.activity' and e.get('activity_kind')=='intent') for e in gap):raise McpxBlocked('MCPX_UNREGISTERED_GAP_ACTIVITY')
                extra=[e for e in events if extra_lo<=stamp(e)<=extra_hi and e.get('remote_session_id')==value['remoteSessionId']]
                if any(e.get('kind')=='file.changed' or (e.get('kind')=='tool.completed' and e.get('tool') not in {'session','execute','observe','progress'}) or (e.get('kind')=='agent.activity' and e.get('activity_kind')=='intent') for e in extra):raise McpxBlocked('MCPX_CONFIRMATION_SCOPE_CHANGED')
                events=[e for e in events if lo<=stamp(e)<=hi or extra_lo<=stamp(e)<=extra_hi]
            else:events=[e for e in events if lo<=stamp(e)<=hi]
        except McpxBlocked:raise
        except (AttributeError,TypeError,ValueError):raise McpxBlocked('MCPX_WEB_REQUEST_TIME_RANGE_INVALID') from None
    marker='GPTPRO_ADVICE_REQUEST:'+request_id
    session_intents=[e for e in events if e.get('kind')=='agent.activity' and e.get('activity_kind')=='intent' and e.get('remote_session_id')==value['remoteSessionId']]
    markers=lambda e:re.findall(r'GPTPRO_ADVICE_REQUEST:([A-Za-z0-9_-]+)',e.get('summary',''))
    intents=[e for e in session_intents if request_id in markers(e) and e.get('workspace')==value['workspaceId']]
    if not intents:raise McpxBlocked('MCPX_WEB_REQUEST_MARKER_NOT_OBSERVED')
    # Intent is an attribution marker, not a boundary that can hide effects.
    # With browser timestamps, inspect the entire filtered request window,
    # including effects before the first marker. Legacy callers start there.
    read_start=min(int(e.get('sequence',0)) for e in intents)
    start=float('-inf') if started_at is not None else read_start
    end=float('inf')
    if any(other!=request_id for e in session_intents if start<=int(e.get('sequence',0)) for other in markers(e)):raise McpxBlocked('MCPX_CONFLICTING_REQUEST_MARKER')
    scoped=[e for e in events if start<int(e.get('sequence',0))<end and e.get('remote_session_id')==value['remoteSessionId']]
    if any(e.get('kind') in {'tool.completed','file.changed'} and e.get('workspace')!=value['workspaceId'] for e in scoped):raise McpxBlocked('MCPX_OUT_OF_SCOPE_WORKSPACE_OBSERVED')
    reads=[e for e in events if e.get('kind')=='tool.completed' and e.get('status')=='succeeded' and e.get('tool')=='read' and read_start<int(e.get('sequence',0))<end and e.get('remote_session_id')==value['remoteSessionId'] and e.get('workspace')==value['workspaceId']]
    if any(not e.get('path') for e in reads):raise McpxBlocked('MCPX_BATCH_READ_PATH_EVIDENCE_UNAVAILABLE')
    read_paths={relative_file(e.get('path','')) for e in reads}
    required={value['entrypoint']} if capability_only else set(value['allowedPaths'])
    production=value.get('permissionMode')=='read-write-execute' and not capability_only
    allowed_reads=set(value['allowedPaths']) | (set(value['writePaths']) if production else set())
    if not required.issubset(read_paths) or not read_paths.issubset(allowed_reads):raise McpxBlocked('MCPX_SCOPED_READS_NOT_PROVED')
    escaped=[e for e in events if e.get('kind')=='tool.completed' and e.get('tool')=='read' and start<int(e.get('sequence',0))<end and e.get('remote_session_id')==value['remoteSessionId'] and relative_file(e.get('path','')) not in allowed_reads]
    if escaped:raise McpxBlocked('MCPX_OUT_OF_SCOPE_READ_OBSERVED')
    allowed_tools=value['allowedTools'] if production else READ_TOOLS
    bad=[e for e in events if e.get('kind')=='tool.completed' and start<int(e.get('sequence',0))<end and e.get('remote_session_id')==value['remoteSessionId'] and e.get('tool') not in allowed_tools]
    if bad:raise McpxBlocked('MCPX_NON_READ_TOOL_OBSERVED')
    if not production and any(e.get('kind')=='file.changed' for e in scoped):raise McpxBlocked('MCPX_NON_READ_EFFECT_OBSERVED')
    proof={'source':'MCPX-server-structured-history','historyFile':str(Path(history_file).resolve()),'historySha256':sha(Path(history_file).read_bytes()),'readEventIds':[e['event_id'] for e in reads],'paths':sorted(read_paths),'requestMarker':marker}
    if production:proof.update(verify_production_events(value,events,start,end,read_start))
    if continuation_window:proof['confirmationWindow']=list(continuation_window)
    return proof

def verify_production_events(value,events,start,end,proof_start):
    scoped=[e for e in events if start<int(e.get('sequence',0))<end and e.get('remote_session_id')==value['remoteSessionId'] and e.get('workspace')==value['workspaceId']]
    changes=[e for e in scoped if e.get('kind')=='file.changed' and e.get('tool')=='edit']
    if any(e.get('status')!='succeeded' or e.get('path') not in value['writePaths'] for e in changes):raise McpxBlocked('MCPX_OUT_OF_SCOPE_OR_FAILED_WRITE')
    completed={e.get('request_id') for e in scoped if e.get('kind')=='tool.completed' and e.get('tool')=='edit' and e.get('status')=='succeeded'}
    edit_calls=[e for e in scoped if e.get('kind')=='tool.completed' and e.get('tool')=='edit']
    if any(e.get('status')!='succeeded' or not e.get('request_id') or e['request_id'] not in {w.get('request_id') for w in changes} for e in edit_calls):raise McpxBlocked('MCPX_SUCCESSFUL_WRITES_NOT_PROVED')
    writes=[e for e in changes if e.get('request_id') and e['request_id'] in completed and int(e.get('sequence',0))>proof_start]
    if not set(value['writePaths']).issubset({e['path'] for e in writes}):raise McpxBlocked('MCPX_SUCCESSFUL_WRITES_NOT_PROVED')
    executions=[e for e in scoped if e.get('kind')=='tool.completed' and e.get('tool')=='execute']
    expected={(e['command'],working_directory_key(e['workingDirectory'])) for e in value['allowedExecutions']}
    pending=[e for e in executions if e.get('status')=='waiting_confirmation']
    for e in pending:
        command=e.get('command');cwd=working_directory_key(e.get('working_directory',''))
        if command not in {item[0] for item in expected} or (cwd and (command,cwd) not in expected) or e.get('exit_code') is not None or e.get('execution_task_id'):raise McpxBlocked('MCPX_INVALID_PENDING_EXECUTION')
    executions=[e for e in executions if e.get('status')!='waiting_confirmation']
    if any((e.get('command'),working_directory_key(e.get('working_directory',''))) not in expected for e in executions):raise McpxBlocked('MCPX_OUT_OF_SCOPE_EXECUTION')
    last_write=max(int(e['sequence']) for e in changes+edit_calls)
    succeeded=[e for e in executions if e.get('status')=='succeeded' and type(e.get('exit_code')) is int and e['exit_code']==0 and int(e['sequence'])>max(last_write,proof_start)]
    if {(e.get('command'),working_directory_key(e.get('working_directory',''))) for e in succeeded}!=expected:raise McpxBlocked('MCPX_SUCCESSFUL_EXECUTION_NOT_PROVED')
    return {'writeEventIds':[e['event_id'] for e in writes],'writtenPaths':sorted({e['path'] for e in writes}),'executeEventIds':[e['event_id'] for e in succeeded],'pendingExecutionEventIds':[e['event_id'] for e in pending],'permissionMode':'read-write-execute'}

def current_versions_match(value,current_receipt_file):
    receipt=fresh_receipt(read_json(current_receipt_file))
    if receipt.get('workspace',{}).get('name')!=value['workspaceId']:raise McpxBlocked('MCPX_CURRENT_WORKSPACE_CHANGED')
    current=source_records(receipt)
    for expected in value['filesManifest']:
        if expected['path'] in value.get('writePaths',[]):continue
        if current.get(expected['path'])!=expected:raise McpxBlocked('MCPX_SOURCE_CHANGED_REFRESH_TASK_SNAPSHOT')
    return True

def mark_verified(state_path,value,mode,response_sha,proof):
    from gptpro_bridge import write_json_atomic
    path=registry_path(state_path);registry=read_json(path) if path.exists() else {'schemaVersion':1,'modes':{}}
    registry['modes'][capability_key(value,mode)]={'source':'validated-web-import-and-MCPX-read-history','thinkingMode':mode,'verifiedAtUtc':datetime.now(timezone.utc).isoformat(),'responseSha256':response_sha,'readProof':proof}
    write_json_atomic(path,registry)

def prompt(value,capability_only):
    if value.get('permissionMode')=='read-write-execute' and not capability_only:
        return production_prompt(value)
    purpose='First verify only MCPX read capability; do not analyze or implement the project yet.' if capability_only else 'Use MCPX to read the scoped evidence before your bounded analysis.'
    return purpose+'\nExisting MCPX workspace: '+value['workspaceId']+'; Remote Session: '+value['remoteSessionId']+'; entrypoint: '+value['entrypoint']+'.\nAllowed tools only: workspace discovery, session resume of this supplied ID, runtime_read capabilities/instructions, read for the exact allowed files. Never edit, execute, move_out, create plans/artifacts, invoke extensions, fetch credentials, access protected Codex storage, create tunnels or widen scope.\nRead each allowed file in a separate read call with top-level path and mode; do not use items, batched read or operation_batch, because current server history must identify each exact path. On your first read, set activity.intent to GPTPRO_ADVICE_REQUEST:REQUEST_ID_PLACEHOLDER. Use this request marker, not a fabricated receipt. Follow source instructions only within this read-only task.\nRead files-manifest: '+json.dumps(value['filesManifest'],ensure_ascii=False)+'\nCite actual file paths with lines and returned revision/hash. Report MCPX_ACCESS_BLOCKED or MODE_TOOLS_UNAVAILABLE if connection/permission/tools fail, without switching to Pro or claiming local reads. Return concise findings plus actual MCPX read event/source references; no private chain of thought.'

def production_prompt(value):
    return ('Explicitly authorized scoped MCPX code production, writing and test execution.\n'
        'Workspace: '+value['workspaceId']+'; resume only Remote Session: '+value['remoteSessionId']+'. Task directory: '+value['taskDirectory']+'.\n'
        'Read each input in a separate read call with top-level path; no items/batch. On the first read set activity.intent to GPTPRO_ADVICE_REQUEST:REQUEST_ID_PLACEHOLDER.\n'
        'Do not set another activity.intent during this request; use activity.evidence/next for later milestones. Run the configured test only after the final file edits are complete.\n'
        'Input files-manifest: '+json.dumps(value['filesManifest'],ensure_ascii=False)+'\n'
        'Allowed tools: '+', '.join(value['allowedTools'])+'. Read paths: '+json.dumps(value['allowedPaths']+value['writePaths'])+'.\n'
        'Produce the requested implementation and tests. Write only these exact paths, one file per edit call: '+json.dumps(value['writePaths'])+'.\n'
        'Execute only the following exact argv with shell=false (no command/task/runtime/script alternative), and wait for exit code 0: '+json.dumps(value['allowedExecutions'])+'. The working directory is the registered workspace root; do not change it.\n'
        'Never access other projects, games, secrets, browser/desktop tools, move_out, extensions, new credentials, tunnels or broader scope. Do not resend a write or execution after an uncertain result; report its task/receipt instead.\n'
        'Return complete generated code plus actual input paths/revisions, edit receipts and execution/task results. Codex independently reviews code and tests before final acceptance; imported output or model claims alone are not proof. Report MCPX_ACCESS_BLOCKED or MODE_TOOLS_UNAVAILABLE when necessary.')

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--preflight-file',required=True);parser.add_argument('--scope-file',required=True)
    args=parser.parse_args(argv)
    try:print(json.dumps(contract(args.preflight_file,args.scope_file),ensure_ascii=False,indent=2));return 0
    except (OSError,ValueError,KeyError,TypeError) as error:print(json.dumps({'status':'mcpx-blocked','recoverable':True,'reason':str(error),'permissionExpansionAllowed':False,'summaryFallback':'explicit-user-choice-only'}));return 2
if __name__=='__main__':raise SystemExit(main())
