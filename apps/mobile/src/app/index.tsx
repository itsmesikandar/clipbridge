import type { ReactElement } from 'react';

import { HomeView } from '@/features/home/home-view';
import { OnboardingView } from '@/features/onboarding/onboarding-view';
import { useAppSnapshot } from '@/state/app-context';

export default function HomeScreen(): ReactElement {
  const snapshot = useAppSnapshot();
  return snapshot.pairing.paired ? (
    <HomeView snapshot={snapshot} />
  ) : (
    <OnboardingView joining={snapshot.pairing.joining} />
  );
}
