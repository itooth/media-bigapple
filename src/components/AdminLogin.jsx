import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api.js';

export default function AdminLogin({ onClose, onSuccess }) {
  const dialog = useRef(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current.showModal(); }, []);
  async function login(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
      onSuccess();
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <dialog className="admin-login" ref={dialog} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} aria-labelledby="admin-login-title">
    <button className="login-close" aria-label="关闭登录" onClick={onClose} disabled={busy}><X size={20} /></button>
    <form onSubmit={login}>
      <h2 id="admin-login-title">管理员登录</h2>
      <label htmlFor="admin-password">管理员密码</label>
      <input id="admin-password" type="password" autoComplete="current-password" autoFocus required maxLength={512} value={password} onChange={(event) => setPassword(event.target.value)} />
      {error && <p className="admin-error" role="alert">{error}</p>}
      <button className="admin-primary" disabled={busy}>{busy ? '正在登录…' : '进入管理'}</button>
    </form>
  </dialog>;
}
