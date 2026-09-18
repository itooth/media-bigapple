import { Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import IconButton from './IconButton.jsx';

export default function SearchPanel({ query, onQueryChange, onClose }) {
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="search-panel">
      <div className="search-inner shell">
        <Search aria-hidden="true" />
        <label className="sr-only" htmlFor="event-search">搜索合作伙伴或活动</label>
        <input
          ref={inputRef}
          id="event-search"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索合作伙伴或活动"
        />
        <span className="search-count" aria-live="polite" />
        <IconButton label="关闭搜索" onClick={onClose}><X aria-hidden="true" /></IconButton>
      </div>
    </div>
  );
}
