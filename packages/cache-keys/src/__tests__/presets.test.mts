import { describe, it, expect } from 'vitest';
import { userKeys } from '../presets/user.mjs';
import { accountKeys } from '../presets/account.mjs';
import { campaignKeys } from '../presets/campaign.mjs';
import { analyticsKeys } from '../presets/analytics.mjs';

describe('preset factories', () => {
  describe('userKeys', () => {
    it('should generate and parse profile keys', () => {
      const key = userKeys.profile.key('user123');
      expect(key).toBe('user:profile:user123');
      expect(userKeys.profile.matches(key)).toBe(true);
      expect(userKeys.profile.parse(key)).toEqual({ id: 'user123' });
    });

    it('should handle encoded IDs in profile keys', () => {
      const key = userKeys.profile.key('user:special');
      expect(key).toBe('user:profile:_e:dXNlcjpzcGVjaWFs');
      expect(userKeys.profile.parse(key)).toEqual({ id: 'user:special' });
    });

    it('should generate and parse session keys', () => {
      const key = userKeys.session.key('user123', 'session456');
      expect(key).toBe('user:session:user123:session456');
      expect(userKeys.session.matches(key)).toBe(true);
      expect(userKeys.session.parse(key)).toEqual({
        userId: 'user123',
        sessionId: 'session456'
      });
    });

    it('should handle encoded values in session keys', () => {
      const key = userKeys.session.key('user:123', 'session:456');
      expect(key).toBe('user:session:_e:dXNlcjoxMjM:_e:c2Vzc2lvbjo0NTY');
      expect(userKeys.session.parse(key)).toEqual({
        userId: 'user:123',
        sessionId: 'session:456'
      });
    });

    it('should generate and parse paginated activity keys', () => {
      const key = userKeys.activity.key('user123', 2, 50);
      expect(key).toBe('user:activity:user123:page_2:limit_50');
      expect(userKeys.activity.matches(key)).toBe(true);
      expect(userKeys.activity.parse(key)).toEqual({
        id: 'user123',
        page: '2',
        limit: '50'
      });
    });

    it('should generate patterns for invalidation', () => {
      expect(userKeys.profile.pattern()).toBe('user:profile:*');
      expect(userKeys.session.pattern()).toBe('user:session:*');
      expect(userKeys.activity.pattern()).toBe('user:activity:*');
    });
  });

  describe('accountKeys', () => {
    it('should generate and parse details keys', () => {
      const key = accountKeys.details.key('acc123');
      expect(key).toBe('account:details:acc123');
      expect(accountKeys.details.matches(key)).toBe(true);
      expect(accountKeys.details.parse(key)).toEqual({ id: 'acc123' });
    });

    it('should generate and parse usage keys', () => {
      const key = accountKeys.usage.key('acc123', '2024-01');
      expect(key).toBe('account:usage:acc123:2024-01');
      expect(accountKeys.usage.matches(key)).toBe(true);
      expect(accountKeys.usage.parse(key)).toEqual({
        accountId: 'acc123',
        period: '2024-01'
      });
    });

    it('should handle encoded values in usage keys', () => {
      const key = accountKeys.usage.key('acc:123', 'period:2024');
      expect(key).toBe('account:usage:_e:YWNjOjEyMw:_e:cGVyaW9kOjIwMjQ');
      expect(accountKeys.usage.parse(key)).toEqual({
        accountId: 'acc:123',
        period: 'period:2024'
      });
    });
  });

  describe('campaignKeys', () => {
    it('should generate and parse performance keys', () => {
      const key = campaignKeys.performance.key('camp123', '2024-01-15');
      expect(key).toBe('campaign:performance:camp123:2024-01-15');
      expect(campaignKeys.performance.matches(key)).toBe(true);
      expect(campaignKeys.performance.parse(key)).toEqual({
        campaignId: 'camp123',
        date: '2024-01-15'
      });
    });

    it('should handle encoded values in performance keys', () => {
      const key = campaignKeys.performance.key('camp:123', 'date:2024');
      expect(key).toBe('campaign:performance:_e:Y2FtcDoxMjM:_e:ZGF0ZToyMDI0');
      expect(campaignKeys.performance.parse(key)).toEqual({
        campaignId: 'camp:123',
        date: 'date:2024'
      });
    });

    it('should generate and parse segment relationship keys', () => {
      const key = campaignKeys.segments.key('camp123', 'seg456');
      expect(key).toBe('campaign:segments:camp123:seg456');
      expect(campaignKeys.segments.matches(key)).toBe(true);
      expect(campaignKeys.segments.parse(key)).toEqual({
        campaignId: 'camp123',
        segmentId: 'seg456'
      });
    });

    it('should generate and parse paginated list keys', () => {
      const key = campaignKeys.list.key('acc123', 1, 20);
      expect(key).toBe('campaign:list:acc123:page_1:limit_20');
      expect(campaignKeys.list.matches(key)).toBe(true);
      expect(campaignKeys.list.parse(key)).toEqual({
        id: 'acc123',
        page: '1',
        limit: '20'
      });
    });
  });

  describe('analyticsKeys', () => {
    it('should generate and parse hourly keys', () => {
      const key = analyticsKeys.hourly.key('metric123', '2024-01-15', 14);
      expect(key).toBe('analytics:hourly:metric123:2024-01-15:14');
      expect(analyticsKeys.hourly.matches(key)).toBe(true);
      expect(analyticsKeys.hourly.parse(key)).toEqual({
        metricId: 'metric123',
        date: '2024-01-15',
        hour: '14'
      });
    });

    it('should handle encoded values in hourly keys', () => {
      const key = analyticsKeys.hourly.key('metric:123', 'date:2024', 14);
      expect(key).toBe('analytics:hourly:_e:bWV0cmljOjEyMw:_e:ZGF0ZToyMDI0:14');
      expect(analyticsKeys.hourly.parse(key)).toEqual({
        metricId: 'metric:123',
        date: 'date:2024',
        hour: '14'
      });
    });

    it('should generate and parse daily keys', () => {
      const key = analyticsKeys.daily.key('metric123', '2024-01-15');
      expect(key).toBe('analytics:daily:metric123:2024-01-15');
      expect(analyticsKeys.daily.matches(key)).toBe(true);
      expect(analyticsKeys.daily.parse(key)).toEqual({
        metricId: 'metric123',
        date: '2024-01-15'
      });
    });

    it('should handle encoded values in daily keys', () => {
      const key = analyticsKeys.daily.key('metric:123', 'date:2024');
      expect(key).toBe('analytics:daily:_e:bWV0cmljOjEyMw:_e:ZGF0ZToyMDI0');
      expect(analyticsKeys.daily.parse(key)).toEqual({
        metricId: 'metric:123',
        date: 'date:2024'
      });
    });

    it('should generate and parse monthly keys', () => {
      const key = analyticsKeys.monthly.key('metric123', '2024-01');
      expect(key).toBe('analytics:monthly:metric123:2024-01');
      expect(analyticsKeys.monthly.matches(key)).toBe(true);
      expect(analyticsKeys.monthly.parse(key)).toEqual({
        metricId: 'metric123',
        yearMonth: '2024-01'
      });
    });

    it('should generate and parse funnel keys', () => {
      const key = analyticsKeys.funnel.key('funnel123', '2024-01-15');
      expect(key).toBe('analytics:funnel:funnel123:2024-01-15');
      expect(analyticsKeys.funnel.matches(key)).toBe(true);
      expect(analyticsKeys.funnel.parse(key)).toEqual({
        funnelId: 'funnel123',
        date: '2024-01-15'
      });
    });

    it('should generate and parse cohort keys', () => {
      const key = analyticsKeys.cohort.key('cohort123', '2024-W03');
      expect(key).toBe('analytics:cohort:cohort123:2024-W03');
      expect(analyticsKeys.cohort.matches(key)).toBe(true);
      expect(analyticsKeys.cohort.parse(key)).toEqual({
        cohortId: 'cohort123',
        period: '2024-W03'
      });
    });

    it('should handle numeric IDs', () => {
      const key = analyticsKeys.daily.key(12345, '2024-01-15');
      expect(key).toBe('analytics:daily:12345:2024-01-15');
      expect(analyticsKeys.daily.parse(key)).toEqual({
        metricId: '12345',
        date: '2024-01-15'
      });
    });

    it('should handle ID objects with toString', () => {
      const objectId = {
        toString() {
          return 'custom-id-789';
        }
      };
      
      const key = analyticsKeys.report.key(objectId);
      expect(key).toBe('analytics:report:custom-id-789');
      expect(analyticsKeys.report.parse(key)).toEqual({ id: 'custom-id-789' });
    });
  });

  describe('edge cases', () => {
    it('should handle empty strings', () => {
      const key = userKeys.profile.key('');
      expect(key).toBe('user:profile:');
      expect(userKeys.profile.parse(key)).toEqual({ id: '' });
    });

    it('should handle special characters in all fields', () => {
      const key = analyticsKeys.cohort.key('*cohort*', '@period@');
      expect(key).toBe('analytics:cohort:_e:KmNvaG9ydCo:_e:QHBlcmlvZEA');
      expect(analyticsKeys.cohort.parse(key)).toEqual({
        cohortId: '*cohort*',
        period: '@period@'
      });
    });

    it('should return null for invalid keys in parse', () => {
      expect(userKeys.session.parse('invalid:key' as any)).toBe(null);
      expect(accountKeys.usage.parse('account:usage:only-one-part' as any)).toBe(null);
      expect(analyticsKeys.hourly.parse('analytics:hourly:missing:parts' as any)).toBe(null);
    });

    it('should correctly identify matching keys', () => {
      expect(userKeys.profile.matches('user:profile:123')).toBe(true);
      expect(userKeys.profile.matches('user:settings:123')).toBe(false);
      expect(userKeys.profile.matches('other:profile:123')).toBe(false);
    });
  });
});