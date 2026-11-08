// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { wsUrl } from './liveSync';

describe('wsUrl', () => {
  it('keeps the path prefix the API is served under', () => {
    expect(wsUrl('https://journey.example.com/api')).toBe('wss://journey.example.com/api/ws');
    expect(wsUrl('https://journey.example.com/api/')).toBe('wss://journey.example.com/api/ws');
  });
  it('maps http to ws and works without a prefix', () => {
    expect(wsUrl('http://localhost:3001')).toBe('ws://localhost:3001/ws');
  });
});
