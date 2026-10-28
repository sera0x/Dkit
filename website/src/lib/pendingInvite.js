const KEY = 'dkit_pending_invite';
const SECTION_KEY = 'dkit_dash_section';

export const getPendingInvite = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
export const setPendingInvite = (t) => { try { localStorage.setItem(KEY, t); } catch {  } };
export const clearPendingInvite = () => { try { localStorage.removeItem(KEY); } catch {  } };

export const requestDashboardSection = (s) => { try { sessionStorage.setItem(SECTION_KEY, s); } catch {  } };
export const takeDashboardSection = () => {
  try { const s = sessionStorage.getItem(SECTION_KEY) || ''; sessionStorage.removeItem(SECTION_KEY); return s; }
  catch { return ''; }
};
