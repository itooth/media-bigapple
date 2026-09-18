import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Plus, Upload } from 'lucide-react';
import logo from '../lib/brandLogo.js';
import { api, logoToPng } from '../lib/api.js';
import AdminLogin from './AdminLogin.jsx';

function ActivitySelect({ activities, selected, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ above: false, height: 290 });
  const container = useRef(null); const trigger = useRef(null); const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!container.current.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') { setOpen(false); trigger.current.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="activity-select" ref={container}>
    <button ref={trigger} className="activity-select-trigger" type="button" disabled={disabled} aria-expanded={open} aria-controls={id} onClick={() => {
      const rect = trigger.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 16;
      const above = below < 250 && rect.top > below;
      setPlacement({ above, height: Math.max(80, Math.min(290, (above ? rect.top - 16 : below) - 84)) });
      setOpen(!open);
    }}>
      已选 {selected.length} 场 <ChevronDown size={16} />
    </button>
    {open && <div className="activity-select-panel" id={id} role="group" aria-label="展示活动" style={{ '--options-height': `${placement.height}px`, ...(placement.above ? { top: 'auto', bottom: 'calc(100% + 8px)' } : {}) }}>
      <p>取消勾选不需要展示的活动</p>
      <div className="activity-options">{activities.map((activity) => <label key={activity.id}>
        <input type="checkbox" checked={selected.includes(activity.id)} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [...selected, activity.id] : selected.filter((id) => id !== activity.id))} />
        <span>{activity.title}</span>
      </label>)}</div>
      <small>包含所选活动的全部照片与作品</small>
    </div>}
  </div>;
}

const sorted = (items) => JSON.stringify([...items].sort());
function ResellerRow({ record, activities, onDirty, onCancel, onLoginNeeded }) {
  const [saved, setSaved] = useState(record.id ? record : null);
  const [name, setName] = useState(record.name);
  const [logoUrl, setLogoUrl] = useState(record.logoUrl);
  const [activityIds, setActivityIds] = useState(() => record.activityIds.filter((id) => activities.some((activity) => activity.id === id)));
  const [file, setFile] = useState(null); const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const inputId = useId();
  const dirty = !saved || !!file || name !== saved.name || logoUrl !== saved.logoUrl || sorted(activityIds) !== sorted(saved.activityIds);
  const key = record.clientKey || record.id;
  useEffect(() => { onDirty(key, dirty); return () => onDirty(key, false); }, [dirty, key, onDirty]);
  useEffect(() => {
    if (!file) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function changeLogo(event) {
    const selectedFile = event.target.files?.[0]; event.target.value = '';
    if (!selectedFile) return;
    setBusy(true); setError(''); setNotice('');
    try { setFile(await logoToPng(selectedFile)); }
    catch (error) { setError(error.message || '无法读取图片，请使用 PNG、JPG、WebP 或 SVG'); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!name.trim()) { setError('请填写网站名称'); return; }
    if (!activityIds.length) { setError('请至少保留一场活动'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      let nextLogo = logoUrl;
      if (file) {
        const result = await api('/api/admin/logos', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: file });
        nextLogo = result.url; setLogoUrl(nextLogo); setFile(null);
      }
      const next = await api(`/api/admin/resellers${saved ? `/${saved.id}` : ''}`, {
        method: saved ? 'PUT' : 'POST',
        body: JSON.stringify({ name, logoUrl: nextLogo, activityIds, version: saved?.version, clientKey: record.clientKey }),
      });
      setSaved(next); setName(next.name); setActivityIds(next.activityIds); setLogoUrl(next.logoUrl); setNotice('已保存');
    } catch (error) { setError(error.message); if (error.status === 401) onLoginNeeded(); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/${saved.id}`); setNotice('链接已复制'); }
    catch { setError(`请复制链接：${window.location.origin}/${saved.id}`); }
  }
  return <div className={`reseller-row ${dirty ? 'has-changes' : ''}`}>
    <div className="reseller-cell reseller-id" data-label="编号"><span>{saved?.id || '自动生成'}</span></div>
    <div className="reseller-cell reseller-logo" data-label="Logo">
      <label className={`logo-upload ${busy ? 'is-busy' : ''}`}>
        {preview || logoUrl ? <img src={preview || logoUrl} alt={`${name || '代理商'} Logo`} /> : <Upload size={22} aria-hidden="true" />}
        <span>{preview || logoUrl ? '更换' : '上传 Logo'}</span>
        <input type="file" aria-label={`上传 ${saved?.id || '新代理商'} Logo`} accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" disabled={busy} onChange={changeLogo} />
      </label>
    </div>
    <div className="reseller-cell" data-label="网站名称"><label className="sr-only" htmlFor={inputId}>网站名称 {saved?.id || '新代理商'}</label><input id={inputId} className="reseller-name" value={name} maxLength={60} placeholder="填写网站名称" disabled={busy} onChange={(event) => { setName(event.target.value); setNotice(''); }} /></div>
    <div className="reseller-cell" data-label="展示活动"><ActivitySelect activities={activities} selected={activityIds} disabled={busy} onChange={(value) => { setActivityIds(value); setNotice(''); }} /></div>
    <div className="reseller-cell reseller-actions" data-label="操作">
      <button className="admin-primary" onClick={save} disabled={busy || !dirty}>{busy ? '保存中…' : '保存'}</button>
      {saved ? <button className="admin-text" onClick={copy}>复制链接</button> : <button className="admin-text" onClick={onCancel} disabled={busy}>取消新增</button>}
    </div>
    {(error || notice) && <div className={`row-feedback ${error ? 'admin-error' : ''}`} role={error ? 'alert' : 'status'}>{error || <><Check size={15} />{notice}</>}</div>}
  </div>;
}

export default function AdminPage({ onBack, setNavigationGuard }) {
  const [rows, setRows] = useState([]); const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [login, setLogin] = useState(false);
  const dirtyRows = useRef(new Map());
  const hasLoaded = useRef(false);
  const onDirty = useCallback((key, dirty) => { if (dirty) dirtyRows.current.set(key, true); else dirtyRows.current.delete(key); }, []);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api('/api/admin/resellers');
      setRows(data.resellers); setActivities(data.activities); dirtyRows.current.clear(); hasLoaded.current = true;
    } catch (error) { if (error.status === 401) setLogin(true); else setError(error.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); document.title = '代理商管理 · BigApple Events'; }, [load]);
  useEffect(() => {
    const leave = (event) => { if (dirtyRows.current.size) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, []);
  const mayLeave = () => !dirtyRows.current.size || window.confirm('有未保存的修改，确定离开吗？');
  useEffect(() => {
    setNavigationGuard(() => !dirtyRows.current.size || window.confirm('有未保存的修改，确定离开吗？'));
    return () => setNavigationGuard(null);
  }, [setNavigationGuard]);
  async function logout() {
    if (!mayLeave()) return;
    try { await api('/api/admin/logout', { method: 'POST' }); onBack(); }
    catch (error) { if (error.status === 401) onBack(); else setError(error.message); }
  }
  return <div className="admin-page">
    <header className="admin-header"><div className="shell admin-header-inner">
      <div className="admin-brand"><img src={logo} alt="BigApple" width="36" height="36" /><strong>代理商管理</strong></div>
      <nav aria-label="后台导航"><button onClick={() => { if (mayLeave()) onBack(); }}><ArrowLeft size={16} />返回原站</button><button onClick={logout}>退出</button></nav>
    </div></header>
    <main className="shell admin-main">
      <div className="admin-toolbar"><div><h1>代理商管理</h1><p>活动默认全选，取消不需要展示的活动，再保存。</p></div>
        <button className="admin-primary" disabled={loading || login || !!error} onClick={() => setRows([...rows, { clientKey: crypto.randomUUID(), name: '', logoUrl: '', activityIds: activities.map((a) => a.id) }])}><Plus size={18} />新增代理商</button>
      </div>
      {loading ? <p role="status">正在读取配置…</p> : error ? <div role="alert" className="admin-error">{error} <button className="admin-text" onClick={load}>重试</button></div> : hasLoaded.current && <div className="reseller-table">
        <div className="reseller-table-head" aria-hidden="true"><span>编号</span><span>Logo</span><span>网站名称</span><span>展示活动</span><span>操作</span></div>
        {rows.length ? rows.map((row) => <ResellerRow key={row.clientKey || row.id} record={row} activities={activities} onDirty={onDirty} onLoginNeeded={() => setLogin(true)} onCancel={() => setRows((current) => current.filter((item) => item !== row))} />) : <div className="admin-empty">还没有代理商。点击“新增代理商”开始配置。</div>}
      </div>}
      <p className="admin-footnote">保存后，代理商链接立即更新。勾选一场活动，即包含全部照片与作品。</p>
    </main>
    {login && <AdminLogin onClose={() => { if (hasLoaded.current) setLogin(false); else onBack(); }} onSuccess={() => { setLogin(false); if (!hasLoaded.current) load(); }} />}
  </div>;
}
