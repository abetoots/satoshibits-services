import { createSimpleKeyFactory, createKeyFactory, createDualKeyFactory, createPaginatedKeyFactory } from '../factory.mjs';
import { sanitizeKeyComponent, splitKeyComponents } from '../sanitizer.mjs';
import type { ID } from '../types.mjs';

/**
 * Campaign-related cache key factories
 */
export const campaignKeys = {
  /**
   * Campaign details key
   * @example campaignKeys.details.key('campaign123')
   * @returns 'campaign:details:campaign123'
   */
  details: createSimpleKeyFactory<`campaign:details:${string}`>(
    'campaign',
    'details'
  ),
  
  /**
   * Campaign statistics key
   * @example campaignKeys.stats.key('campaign123')
   * @returns 'campaign:stats:campaign123'
   */
  stats: createSimpleKeyFactory<`campaign:stats:${string}`>(
    'campaign',
    'stats'
  ),
  
  /**
   * Campaign performance by date key
   * @example campaignKeys.performance.key('campaign123', '2024-01-15')
   * @returns 'campaign:performance:campaign123:2024-01-15'
   */
  performance: createKeyFactory<`campaign:performance:${string}:${string}`, [campaignId: ID, date: string]>(
    'campaign',
    'performance',
    (campaignId: ID, date: string) => 
      `${sanitizeKeyComponent(String(campaignId))}:${sanitizeKeyComponent(date)}`,
    (suffix: string) => {
      const parts = splitKeyComponents(suffix, ':', true);
      if (parts.length !== 2) return null;
      return {
        campaignId: parts[0] ?? '',
        date: parts[1] ?? ''
      };
    }
  ),
  
  /**
   * Campaign list by account paginated key
   * @example campaignKeys.list.key('account123', 1, 20)
   * @returns 'campaign:list:account123:page_1:limit_20'
   */
  list: createPaginatedKeyFactory<`campaign:list:${string}:page_${number}:limit_${number}`>(
    'campaign',
    'list'
  ),
  
  /**
   * Campaign targeting rules key
   * @example campaignKeys.targeting.key('campaign123')
   * @returns 'campaign:targeting:campaign123'
   */
  targeting: createSimpleKeyFactory<`campaign:targeting:${string}`>(
    'campaign',
    'targeting'
  ),
  
  /**
   * Campaign budget key
   * @example campaignKeys.budget.key('campaign123')
   * @returns 'campaign:budget:campaign123'
   */
  budget: createSimpleKeyFactory<`campaign:budget:${string}`>(
    'campaign',
    'budget'
  ),
  
  /**
   * Campaign segments relationship key
   * @example campaignKeys.segments.key('campaign123', 'segment456')
   * @returns 'campaign:segments:campaign123:segment456'
   */
  segments: createDualKeyFactory<`campaign:segments:${string}:${string}`>(
    'campaign',
    'segments',
    'campaignId',
    'segmentId'
  ),
  
  /**
   * Campaign creative assets key
   * @example campaignKeys.creatives.key('campaign123')
   * @returns 'campaign:creatives:campaign123'
   */
  creatives: createSimpleKeyFactory<`campaign:creatives:${string}`>(
    'campaign',
    'creatives'
  ),
  
  /**
   * Campaign schedule key
   * @example campaignKeys.schedule.key('campaign123')
   * @returns 'campaign:schedule:campaign123'
   */
  schedule: createSimpleKeyFactory<`campaign:schedule:${string}`>(
    'campaign',
    'schedule'
  ),
  
  /**
   * Campaign conversion tracking key
   * @example campaignKeys.conversions.key('campaign123')
   * @returns 'campaign:conversions:campaign123'
   */
  conversions: createSimpleKeyFactory<`campaign:conversions:${string}`>(
    'campaign',
    'conversions'
  ),
} as const;