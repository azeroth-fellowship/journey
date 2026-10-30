// SPDX-License-Identifier: GPL-3.0-only
import { z } from 'zod';

/** ISO-8601 timestamp string. */
export const IsoTimestamp = z.string().datetime({ offset: true });

/** Non-empty identifier string. */
export const Id = z.string().min(1);

/** Source of an event or upload. */
export const EventSource = z.enum(['addon', 'simulator', 'desktop', 'api']);

export type EventSource = z.infer<typeof EventSource>;