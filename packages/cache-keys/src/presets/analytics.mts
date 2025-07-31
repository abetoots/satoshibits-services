import { createKeyFactory, createSimpleKeyFactory } from '../factory.mjs';
import { sanitizeKeyComponent, splitKeyComponents } from '../sanitizer.mjs';
import type { ID } from '../types.mjs';

/**
 * Analytics-related cache key factories
 */
export const analyticsKeys = {
  /**
   * Real-time analytics data key
   * @example analyticsKeys.realtime.key('dashboard123')
   * @returns 'analytics:realtime:dashboard123'
   */
  realtime: createSimpleKeyFactory<`analytics:realtime:${string}`>(
    'analytics',
    'realtime'
  ),
  
  /**
   * Hourly aggregated metrics key
   * @example analyticsKeys.hourly.key('metric123', '2024-01-15', 14)
   * @returns 'analytics:hourly:metric123:2024-01-15:14'
   */
  hourly: createKeyFactory<`analytics:hourly:${string}:${string}:${string}`, [metricId: ID, date: string, hour: number]>(
    'analytics',
    'hourly',
    (metricId: ID, date: string, hour: number) => 
      `${sanitizeKeyComponent(String(metricId))}:${sanitizeKeyComponent(date)}:${hour}`,
    (suffix: string) => {
      const parts = splitKeyComponents(suffix, ':', true);
      if (parts.length !== 3) return null;
      
      return {
        metricId: parts[0] || '',
        date: parts[1] || '',
        hour: parts[2] || ''
      };
    }
  ),
  
  /**
   * Daily aggregated metrics key
   * @example analyticsKeys.daily.key('metric123', '2024-01-15')
   * @returns 'analytics:daily:metric123:2024-01-15'
   */
  daily: createKeyFactory<`analytics:daily:${string}:${string}`, [metricId: ID, date: string]>(
    'analytics',
    'daily',
    (metricId: ID, date: string) => 
      `${sanitizeKeyComponent(String(metricId))}:${sanitizeKeyComponent(date)}`,
    (suffix: string) => {
      const parts = splitKeyComponents(suffix, ':', true);
      if (parts.length !== 2) return null;
      return {
        metricId: parts[0] || '',
        date: parts[1] || ''
      };
    }
  ),
  
  /**
   * Monthly aggregated metrics key
   * @example analyticsKeys.monthly.key('metric123', '2024-01')
   * @returns 'analytics:monthly:metric123:2024-01'
   */
  monthly: createKeyFactory<`analytics:monthly:${string}:${string}`, [metricId: ID, yearMonth: string]>(
    'analytics',
    'monthly',
    (metricId: ID, yearMonth: string) => 
      `${sanitizeKeyComponent(String(metricId))}:${sanitizeKeyComponent(yearMonth)}`,
    (suffix: string) => {
      const parts = splitKeyComponents(suffix, ':', true);
      if (parts.length !== 2) return null;
      return {
        metricId: parts[0] || '',
        yearMonth: parts[1] || ''
      };
    }
  ),
  
  /**
   * Custom report key
   * @example analyticsKeys.report.key('report123')
   * @returns 'analytics:report:report123'
   */
  report: createSimpleKeyFactory<`analytics:report:${string}`>(
    'analytics',
    'report'
  ),
  
  /**
   * Funnel analysis key
   * @example analyticsKeys.funnel.key('funnel123', '2024-01-15')
   * @returns 'analytics:funnel:funnel123:2024-01-15'
   */
  funnel: createKeyFactory<`analytics:funnel:${string}:${string}`, [funnelId: ID, date: string]>(
    'analytics',
    'funnel',
    (funnelId: ID, date: string) => 
      `${sanitizeKeyComponent(String(funnelId))}:${sanitizeKeyComponent(date)}`,
    (suffix: string) => {
      const parts = splitKeyComponents(suffix, ':', true);
      if (parts.length !== 2) return null;
      return {
        funnelId: parts[0] || '',
        date: parts[1] || ''
      };
    }
  ),
  
  /**
   * Cohort analysis key
   * @example analyticsKeys.cohort.key('cohort123', '2024-W03')
   * @returns 'analytics:cohort:cohort123:2024-W03'
   */
  cohort: createKeyFactory<`analytics:cohort:${string}:${string}`, [cohortId: ID, period: string]>(
    'analytics',
    'cohort',
    (cohortId: ID, period: string) => 
      `${sanitizeKeyComponent(String(cohortId))}:${sanitizeKeyComponent(period)}`,
    (suffix: string) => {
      const parts = splitKeyComponents(suffix, ':', true);
      if (parts.length !== 2) return null;
      return {
        cohortId: parts[0] || '',
        period: parts[1] || ''
      };
    }
  ),
  
  /**
   * Event stream buffer key
   * @example analyticsKeys.eventStream.key('stream123')
   * @returns 'analytics:eventStream:stream123'
   */
  eventStream: createSimpleKeyFactory<`analytics:eventStream:${string}`>(
    'analytics',
    'eventStream'
  ),
  
  /**
   * Dashboard configuration key
   * @example analyticsKeys.dashboard.key('dashboard123')
   * @returns 'analytics:dashboard:dashboard123'
   */
  dashboard: createSimpleKeyFactory<`analytics:dashboard:${string}`>(
    'analytics',
    'dashboard'
  ),
} as const;