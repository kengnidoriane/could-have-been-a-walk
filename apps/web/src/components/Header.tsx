import type { ReactNode } from 'react';
import { navigate, paths } from '../lib/router';
import { ModelPill } from './ModelPill';

interface HeaderProps {
  children?: ReactNode;
  /** The walk page runs on a phone with no local API: don't ask it for the model. */
  showModel?: boolean;
}

export function Header({ children, showModel = true }: HeaderProps) {
  return (
    <header className="topbar">
      <a
        className="brand"
        href="#/"
        onClick={(e) => {
          e.preventDefault();
          navigate(paths.plan());
        }}
      >
        <img src="./favicon.svg" alt="" width="28" height="28" />
        <span>Could&rsquo;ve Been a Walk</span>
      </a>
      <div className="topbar-right">
        {children}
        {showModel && <ModelPill />}
      </div>
    </header>
  );
}
