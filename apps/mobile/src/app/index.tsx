import type { ReactElement } from 'react';

import { AboutView } from '@/features/about/about-view';
import { useAboutPresenter } from '@/features/about/use-about-presenter';

export default function HomeScreen(): ReactElement {
  const about = useAboutPresenter();
  return <AboutView state={about} />;
}
