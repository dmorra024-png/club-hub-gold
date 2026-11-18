/**
 * Read-only representation of a collaborator's shift.
 * A shift begins on the actual cash-session open and ends on its actual close.
 * No fixed schedules, shift numbers, assumed midnight closing or global hours.
 * This module does not operate cash or replace existing management logic.
 */
const uuid=x=>typeof x==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(x);
const error=code=>Object.assign(new Error(code),{code});
const instant=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
export function collaboratorCashShift(session){
 if(!session||!uuid(session.id)||!uuid(session.clubId)||!uuid(session.userId))
  throw error('CASH_SESSION_INVALID');
 const start=instant(session.openedAt),end=session.closedAt==null?null:instant(session.closedAt);
 if(start===null||(session.closedAt!=null&&end===null)||(end!==null&&end<start))
  throw error('CASH_SESSION_TIME_INVALID');
 if(session.status!==(end===null?'open':'closed'))throw error('CASH_SESSION_STATUS_INVALID');
 if(session.closedBy!=null&&!uuid(session.closedBy))throw error('CASH_CLOSER_INVALID');
 if(end!==null&&!uuid(session.closedBy))throw error('CASH_CLOSER_REQUIRED');
 return Object.freeze({
  sessionId:session.id,clubId:session.clubId,
  collaboratorId:session.userId,
  startedAt:new Date(start).toISOString(),
  endedAt:end===null?null:new Date(end).toISOString(),
  closedBy:session.closedBy??null,
  status:end===null?'open':'closed',
  durationMs:end===null?null:end-start
 });
}
export function shiftsForClub(sessions,clubId){
 if(!uuid(clubId)||!Array.isArray(sessions))throw error('CASH_SCOPE_INVALID');
 // Reject mixing clubs rather than silently reporting another club's turnover.
 const result=sessions.map(collaboratorCashShift);
 if(result.some(s=>s.clubId!==clubId))throw error('CASH_TENANT_MISMATCH');
 return result.sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
}
