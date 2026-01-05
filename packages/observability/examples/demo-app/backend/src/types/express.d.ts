import { SmartClient } from '@satoshibits/observability'

declare global {
  namespace Express {
    interface Request {
      observabilityClient?: Awaited<ReturnType<typeof SmartClient.initialize>> | null
    }
  }
}