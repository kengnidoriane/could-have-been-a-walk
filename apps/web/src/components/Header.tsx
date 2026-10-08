import type { ReactNode } from 'react';
import { navigate, paths } from '../lib/router';

export function Header({ children }: { children?: ReactNode }) {
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
      <div className="topbar-right">{children}</div>
    </header>
  );
}
