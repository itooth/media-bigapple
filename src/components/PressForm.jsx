import { useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * 报道表单：全部手填（媒体名 / 标题 / 链接 / 日期 / 截图）。
 * 截图先传到 /api/admin/press-images 拿一个 https 地址，
 * 再把地址和文字一起写进这场活动的 social[]。
 */
export default function PressForm({ uid, onClose, onSaved }) {
  const [form, setForm] = useState({ outlet: '', title: '', href: '', date: '' });
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef(null);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const upload = async (file) => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const { url } = await api('/api/admin/press-images', { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'image/png' } });
      setImage(url);
    } catch (err) {
      setError(err.message || '截图上传失败');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true); setError('');
    try {
      const body = { ...form, image };
      await api(`/api/activities/${encodeURIComponent(uid)}/press`, { method: 'POST', body: JSON.stringify(body) });
      onSaved?.();
    } catch (err) {
      setError(err.message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="press-form-backdrop" role="dialog" aria-modal="true" aria-label="添加报道" onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <div className="press-form">
        <header><strong>添加报道</strong><button type="button" aria-label="关闭" onClick={onClose}>✕</button></header>
        <label>媒体名<input value={form.outlet} onChange={set('outlet')} placeholder="读特 / 深圳特区报 / 公众号名" /></label>
        <label>报道标题<input value={form.title} onChange={set('title')} placeholder="报道原文标题" /></label>
        <label>链接<input value={form.href} onChange={set('href')} placeholder="https://" inputMode="url" /></label>
        <label>发布日期<input value={form.date} onChange={set('date')} placeholder="2026-05-13" inputMode="numeric" /></label>
        <label>报道截图
          <button className="press-form-upload" type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
            {image ? '已上传，点击替换' : '拖入图片 / 点击选择'}
          </button>
          {image ? <img className="press-form-preview" src={image} alt="报道截图预览" /> : null}
        </label>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => upload(event.target.files?.[0])} />
        {error ? <p className="press-form-error">{error}</p> : null}
        <footer>
          <button type="button" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="is-primary" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        </footer>
      </div>
    </div>
  );
}
