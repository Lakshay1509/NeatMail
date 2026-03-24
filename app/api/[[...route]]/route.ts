import { Hono } from "hono";
import { handle } from "hono/vercel";
import email from './email'
import webhook from './gmail-webhook'
import watch from './activate-watch'
import clerk from './clerk'
import tags from './tags'
import user from './user'
import checkout from './checkout'
import dodowebhook from './dodo-webhook'
import cron from './cron'
import draftPreference from './draft-preference'
import outlook from './outlook'
import stats from './stats'


export const runtime = "nodejs";
export const dynamic = 'force-dynamic';
export const dynamicParams = true;

const app = new Hono().basePath("/api");
const routes = app
    .route('/email',email)
    .route('/gmail-webhook',webhook)
    .route('/activate-watch',watch)
    .route('/clerk',clerk)
    .route('/tags',tags)
    .route('/user',user)
    .route('/checkout',checkout)
    .route('/dodowebhook',dodowebhook)
    .route('/cron',cron)
    .route('/draft-preference',draftPreference)
    .route('/outlook',outlook)
    .route('/stats',stats)




export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);

export type AppType = typeof routes;