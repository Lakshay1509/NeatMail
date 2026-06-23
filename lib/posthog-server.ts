import { PostHog } from 'posthog-node'

type PostHogClient = Pick<PostHog, 'capture' | 'shutdown'>

let posthogClient: PostHogClient | null = null

const noopClient: PostHogClient = {
  capture() {},
  async shutdown() {},
}

export function getPostHogClient(): PostHogClient {
  if (process.env.NODE_ENV === 'development') {
    return noopClient
  }
  if (!posthogClient) {
    posthogClient = new PostHog(
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!,
      {
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
        flushAt: 1,
        flushInterval: 0,
      }
    )
  }
  return posthogClient
}

export async function shutdownPostHog() {
  if (posthogClient) {
    await posthogClient.shutdown()
  }
}
