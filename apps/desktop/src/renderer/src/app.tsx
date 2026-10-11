import type { ReactElement } from 'react';

import { AboutView } from './features/about/about-view';
import { useAboutPresenter } from './features/about/use-about-presenter';

export function App(): ReactElement {
  const about = useAboutPresenter(window.clipbridge);
  return (
    <main className="app">
      <h1 className="app__title">ClipBridge</h1>
      <AboutView state={about} />
    </main>
  );
}
