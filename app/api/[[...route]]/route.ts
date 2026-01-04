import { Hono } from "hono";
import { handle } from "hono/vercel";
import email from './email'


export const runtime = "nodejs";
export const dynamic = 'force-dynamic';
export const dynamicParams = true;

const app = new Hono().basePath("/api");
const routes = app
    .route('/email',email)



export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);

export type AppType = typeof routes;