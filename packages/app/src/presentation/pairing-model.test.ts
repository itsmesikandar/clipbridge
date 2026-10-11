import { appError } from '@clipbridge/core';
import { describe, expect, it } from 'vitest';

import type { HostingView } from '../view-types';
import { describeJoinState, formatCountdown, svgToDataUrl, toHostingModel } from './pairing-model';

const base: HostingView = {
  code: 'K7QM-2XPA-9FRT',
  qrSvg: '<svg/>',
  expiresAt: 120_000,
  address: '192.168.1.7:47821',
  state: 'waiting',
  attemptsLeft: 3,
  request: null,
  addedDeviceName: null,
  error: null,
};

describe('pairing view model', () => {
  it('counts down to expiry', () => {
    expect(formatCountdown(95_000)).toBe('1:35');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(toHostingModel(base, 25_000)).toMatchObject({
      phase: 'show-code',
      message: 'Expires in 1:35.',
    });
  });

  it('warns after a wrong code', () => {
    expect(toHostingModel({ ...base, attemptsLeft: 2 }, 0).message).toContain('2 attempt(s) left');
  });

  it('asks for approval with the device name and a warning', () => {
    const model = toHostingModel(
      { ...base, state: 'awaiting-approval', request: { name: 'Pixel 8', platform: 'android' } },
      0,
    );
    expect(model).toMatchObject({ phase: 'approve', title: 'Allow "Pixel 8" to join?' });
    expect(model.message).toContain('Only allow devices you own');
  });

  it('reports the outcome', () => {
    expect(
      toHostingModel({ ...base, state: 'completed', addedDeviceName: 'Pixel 8' }, 0).title,
    ).toBe('"Pixel 8" was added');
    expect(
      toHostingModel({ ...base, state: 'failed', error: appError('PAIRING_EXPIRED', '', {}) }, 0),
    ).toMatchObject({ phase: 'ended', title: 'Pairing expired' });
    expect(toHostingModel({ ...base, state: 'cancelled' }, 0).phase).toBe('ended');
  });

  it('describes join progress', () => {
    expect(describeJoinState('awaiting-approval', null)).toBe(
      'Waiting — click "Allow" on the other computer.',
    );
    expect(
      describeJoinState('failed', appError('PAIRING_CODE_INVALID', '', { attemptsLeft: 1 })),
    ).toBe('Wrong code. 1 attempt(s) left.');
    expect(describeJoinState('idle', null)).toBeNull();
  });

  it('embeds SVG as a data URL', () => {
    expect(svgToDataUrl('<svg a="1"/>')).toBe('data:image/svg+xml;utf8,%3Csvg%20a%3D%221%22%2F%3E');
  });
});
