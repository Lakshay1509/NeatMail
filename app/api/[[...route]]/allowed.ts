import { Hono } from "hono";
import { db } from "@/lib/prisma";

const app = new Hono()
    .get('/', async (ctx) => {
        const token = ctx.req.query("token");

        if (!token) {
            return ctx.json({ error: "Token is required" }, 400);
        }

        try {
            const tokenRecord = await db.allowedToken.findUnique({
                where: {
                    token: token,
                },
            });

            if (!tokenRecord) {
                return ctx.json({ valid: false, message: "Token not found" }, 404);
            }

            if (tokenRecord.is_used) {
                return ctx.json({ valid: false, message: "Token has already been used" }, 400);
            }

            return ctx.json({ valid: true, data: tokenRecord }, 200);
        } catch (error) {
            console.error("Error finding token:", error);
            return ctx.json({ error: "Internal Server Error" }, 500);
        }
    })
    .get('/email', async (ctx) => {
        const email = ctx.req.query("email");

        if (!email) {
            return ctx.json({ error: "Email is required" }, 400);
        }

        try {
            const user = await db.user_tokens.findUnique({
                where: {email:email}
            });

            if (user) {
                return ctx.json({ valid: true, message: "User is already signed in" }, 200);
            } else {
                return ctx.json({ valid: false, message: "User not found" }, 404);
            }
        } catch (error) {
            console.error("Error finding user:", error);
            return ctx.json({ error: "Internal Server Error" }, 500);
        }
    });

export default app;