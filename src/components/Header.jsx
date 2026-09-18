import { Menu, Search, X } from 'lucide-react';
import { useState } from 'react';
import logo from '../lib/brandLogo.js';
import IconButton from './IconButton.jsx';

function NavButton({ active, children, ...props }) {
  return (
    <button
      className={`nav-link ${active ? 'is-active' : ''}`}
      type="button"
      aria-current={active ? 'page' : undefined}
      {...props}
    >
      {children}
    </button>
  );
}

export default function Header({ activeNav, onNavChange, onSearchOpen, onBrandClick, brand }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const selectNav = (target) => {
    onNavChange(target);
    setMobileOpen(false);
  };

  const openSearch = () => {
    setMobileOpen(false);
    onSearchOpen();
  };

  return (
    <header className="site-header">
      <div className="header-inner shell">
        <button className={`brand-button${brand ? ' has-custom-brand' : ''}`} type="button" aria-label="返回活动列表" onClick={onBrandClick ?? (() => selectNav('events'))}>
          {brand && !brand.logoUrl ? <span className="brand-placeholder" aria-hidden="true">{brand.name.slice(0, 1)}</span> : <img src={brand ? brand.logoUrl : logo} alt={`${brand?.name || 'BigApple'} 标志`} width="40" height="40" />}
          <span>{brand?.name || 'BigApple Events'}</span>
        </button>

        <nav className="desktop-nav" aria-label="主导航">
          <NavButton active={activeNav === 'events'} onClick={() => { selectNav('events'); onBrandClick?.(); }}>Events</NavButton>
          <NavButton active={activeNav === 'partners'} onClick={() => selectNav('partners')}>Partners</NavButton>
          <NavButton active={activeNav === 'about'} onClick={() => selectNav('about')}>About</NavButton>
          <NavButton disabled>Newsroom</NavButton>
          <span className="nav-divider" aria-hidden="true" />
          <button className="search-trigger icon-text-button" type="button" onClick={openSearch}>
            <Search aria-hidden="true" />
            <span>Search</span>
          </button>
        </nav>

        <IconButton
          className="mobile-menu-trigger"
          label={mobileOpen ? '关闭导航' : '打开导航'}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          onClick={() => setMobileOpen((current) => !current)}
        >
          {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </IconButton>
      </div>

      {mobileOpen ? (
        <nav className="mobile-nav" id="mobile-nav" aria-label="移动端导航">
          <NavButton active={activeNav === 'events'} onClick={() => { selectNav('events'); onBrandClick?.(); }}>Events</NavButton>
          <NavButton active={activeNav === 'partners'} onClick={() => selectNav('partners')}>Partners</NavButton>
          <NavButton active={activeNav === 'about'} onClick={() => selectNav('about')}>About</NavButton>
          <NavButton disabled>Newsroom</NavButton>
          <NavButton onClick={openSearch}>Search</NavButton>
        </nav>
      ) : null}
    </header>
  );
}
