import { Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import IconButton from './IconButton.jsx';

export default function SearchPanel({ query, onQueryChange, onClose, count = 0, placeholder = '搜索活动或案例' }) {
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="search-panel">
      <div className="search-inner shell">
        <Search aria-hidden="true" />
        <label className="sr-only" htmlFor="event-search">{placeholder}</label>
        <input
          ref={inputRef}
          id="event-search"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
        />
        <span className="search-count" aria-live="polite">共 {count} 个结果</span>
        <IconButton label="关闭搜索" onClick={onClose}><X aria-hidden="true" /></IconButton>
      </div>
    </div>
  );
}
