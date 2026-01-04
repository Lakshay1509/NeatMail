import { config } from 'dotenv'
import { defineConfig, env } from 'prisma/config'

if (process.env.NODE_ENV !== 'production') {
  config({ path: '.env.local' })
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DIRECT_URL') || env('DATABASE_URL'),
  },
})